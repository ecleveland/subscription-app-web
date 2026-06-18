import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, AnyBulkWriteOperation } from 'mongoose';
import {
  Subscription,
  SubscriptionDocument,
  BillingCycle,
} from './schemas/subscription.schema';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';
import { QuerySubscriptionDto } from './dto/query-subscription.dto';
import { BulkOperationDto, BulkAction } from './dto/bulk-operation.dto';
import { PaginatedSubscriptions } from './interfaces/paginated-subscriptions.interface';
import { BulkOperationResult } from './interfaces/bulk-operation-result.interface';

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);
  static readonly ADVANCE_BATCH_SIZE = 500;

  constructor(
    @InjectModel(Subscription.name)
    private subscriptionModel: Model<SubscriptionDocument>,
  ) {}

  static advanceToFutureDate(
    currentDate: Date,
    billingCycle: BillingCycle,
    now: Date = new Date(),
  ): Date {
    const result = new Date(currentDate);
    const originalDay = currentDate.getUTCDate();

    while (result <= now) {
      if (billingCycle === BillingCycle.WEEKLY) {
        result.setUTCDate(result.getUTCDate() + 7);
        continue;
      }

      const targetMonth =
        billingCycle === BillingCycle.MONTHLY
          ? (result.getUTCMonth() + 1) % 12
          : result.getUTCMonth();

      if (billingCycle === BillingCycle.MONTHLY) {
        result.setUTCMonth(result.getUTCMonth() + 1);
      } else {
        result.setUTCFullYear(result.getUTCFullYear() + 1);
      }

      // If month overflowed (e.g. Jan 31 → Mar 3), clamp to last day of target month
      if (result.getUTCMonth() !== targetMonth) {
        result.setUTCDate(0);
      }

      // Try to restore the original day-of-month when the month supports it
      if (result.getUTCDate() !== originalDay) {
        const month = result.getUTCMonth();
        result.setUTCDate(originalDay);
        if (result.getUTCMonth() !== month) {
          result.setUTCDate(0);
        }
      }
    }

    return result;
  }

  private static getMonthlyCost(
    cost: number,
    billingCycle: BillingCycle,
  ): number {
    if (billingCycle === BillingCycle.WEEKLY) return cost * 4.33;
    return billingCycle === BillingCycle.YEARLY ? cost / 12 : cost;
  }

  /**
   * Advance every active subscription whose billing date is in the past to its
   * next future date. Runs from a scheduled cron (see SubscriptionsCronService)
   * — never from a read path — and streams matches with a cursor, flushing
   * `bulkWrite` batches so memory stays bounded regardless of dataset size.
   * The per-op `nextBillingDate: { $lte: now }` guard keeps each update atomic.
   */
  async advanceOverdueDates(): Promise<number> {
    const now = new Date();
    const cursor = this.subscriptionModel
      .find({
        isActive: true,
        nextBillingDate: { $lte: now },
      } as Record<string, unknown>)
      .lean()
      .cursor();

    let bulkOps: AnyBulkWriteOperation<SubscriptionDocument>[] = [];
    let advanced = 0;

    const flush = async (): Promise<void> => {
      if (bulkOps.length === 0) return;
      // `ordered: false` so one failing op doesn't abort the rest of the batch.
      const result = await this.subscriptionModel.bulkWrite(bulkOps, {
        ordered: false,
      });
      advanced += result.modifiedCount ?? 0;
      bulkOps = [];
    };

    for await (const sub of cursor) {
      const newDate = SubscriptionsService.advanceToFutureDate(
        sub.nextBillingDate,
        sub.billingCycle,
        now,
      );
      bulkOps.push({
        updateOne: {
          filter: {
            _id: sub._id,
            nextBillingDate: { $lte: now },
          },
          update: { $set: { nextBillingDate: newDate } },
        },
      });
      if (bulkOps.length >= SubscriptionsService.ADVANCE_BATCH_SIZE) {
        await flush();
      }
    }
    await flush();

    return advanced;
  }

  async create(
    householdId: string,
    memberId: string,
    createDto: CreateSubscriptionDto,
  ): Promise<SubscriptionDocument> {
    const subscription = new this.subscriptionModel({
      ...createDto,
      householdId: new Types.ObjectId(householdId),
      memberId: new Types.ObjectId(memberId),
    });
    const saved = await subscription.save();
    this.logger.log(
      { householdId, memberId, subscriptionId: saved._id.toString() },
      'Subscription created',
    );
    return saved;
  }

  async findAll(
    householdId: string,
    query: QuerySubscriptionDto,
  ): Promise<PaginatedSubscriptions> {
    const filter: Record<string, unknown> = {
      householdId: new Types.ObjectId(householdId),
    };

    if (query.category) {
      filter.category = query.category;
    }
    if (query.billingCycle) {
      filter.billingCycle = query.billingCycle;
    }
    if (query.tags) {
      const tagList = query.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      if (tagList.length > 0) {
        filter.tags = { $in: tagList };
      }
    }
    if (query.shared === 'shared') {
      filter.sharedWith = { $gte: 2 };
    } else if (query.shared === 'individual') {
      filter.sharedWith = { $in: [null, undefined] };
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = limit === 0 ? 0 : (page - 1) * limit;

    const total = await this.subscriptionModel.countDocuments(filter).exec();

    const sortBy = query.sortBy || 'createdAt';
    const sortOrder = query.sortOrder === 'asc' ? 1 : -1;

    let data: SubscriptionDocument[];

    if (sortBy === 'cost') {
      const subscriptions = await this.subscriptionModel.find(filter).exec();
      const sorted = subscriptions.sort((a, b) => {
        const aCost = SubscriptionsService.getMonthlyCost(
          a.cost,
          a.billingCycle,
        );
        const bCost = SubscriptionsService.getMonthlyCost(
          b.cost,
          b.billingCycle,
        );
        return (aCost - bCost) * sortOrder;
      });
      data = limit === 0 ? sorted : sorted.slice(skip, skip + limit);
    } else {
      const q = this.subscriptionModel
        .find(filter)
        .sort({ [sortBy]: sortOrder });
      if (limit !== 0) {
        q.skip(skip).limit(limit);
      }
      data = await q.exec();
    }

    const totalPages = limit === 0 ? 1 : Math.ceil(total / limit);
    const hasNextPage = limit === 0 ? false : page < totalPages;

    return {
      data,
      meta: { total, page, limit, totalPages, hasNextPage },
    };
  }

  async findOne(
    householdId: string,
    id: string,
  ): Promise<SubscriptionDocument> {
    const subscription = await this.subscriptionModel.findById(id).exec();
    if (
      !subscription ||
      !subscription.householdId ||
      !new Types.ObjectId(householdId).equals(
        subscription.householdId as unknown as Types.ObjectId,
      )
    ) {
      throw new NotFoundException(`Subscription with ID "${id}" not found`);
    }
    return subscription;
  }

  async update(
    householdId: string,
    id: string,
    updateDto: UpdateSubscriptionDto,
  ): Promise<SubscriptionDocument> {
    const existing = await this.findOne(householdId, id);
    Object.assign(existing, updateDto);
    const saved = await existing.save();
    this.logger.log(
      { householdId, subscriptionId: id },
      'Subscription updated',
    );
    return saved;
  }

  async remove(householdId: string, id: string): Promise<void> {
    const deleted = await this.subscriptionModel
      .findOneAndDelete({
        _id: new Types.ObjectId(id),
        householdId: new Types.ObjectId(householdId),
      } as Record<string, unknown>)
      .exec();

    if (!deleted) {
      throw new NotFoundException(`Subscription with ID "${id}" not found`);
    }
    this.logger.log(
      { householdId, subscriptionId: id },
      'Subscription deleted',
    );
  }

  async bulkOperation(
    householdId: string,
    dto: BulkOperationDto,
  ): Promise<BulkOperationResult> {
    const ids = dto.ids.map((id) => new Types.ObjectId(id));
    const filter = {
      _id: { $in: ids },
      householdId: new Types.ObjectId(householdId),
    } as Record<string, unknown>;

    const validDocs = await this.subscriptionModel.find(filter).exec();
    const validIds = validDocs.map((doc) => doc._id);

    if (validIds.length === 0) {
      return { success: 0, failed: dto.ids.length };
    }

    const validFilter = {
      _id: { $in: validIds },
      householdId: new Types.ObjectId(householdId),
    } as Record<string, unknown>;

    // Report the count actually affected by the write (deletedCount, or
    // matchedCount for updates — matched, not modified, so re-applying a value a
    // doc already has still counts as a success), rather than the pre-write
    // candidate count which would over-report if a concurrent change raced us.
    let success = 0;
    switch (dto.action) {
      case BulkAction.DELETE: {
        const res = await this.subscriptionModel.deleteMany(validFilter).exec();
        success = res.deletedCount;
        break;
      }
      case BulkAction.ACTIVATE: {
        const res = await this.subscriptionModel
          .updateMany(validFilter, { $set: { isActive: true } })
          .exec();
        success = res.matchedCount;
        break;
      }
      case BulkAction.DEACTIVATE: {
        const res = await this.subscriptionModel
          .updateMany(validFilter, { $set: { isActive: false } })
          .exec();
        success = res.matchedCount;
        break;
      }
      case BulkAction.CHANGE_CATEGORY: {
        if (!dto.category) {
          throw new BadRequestException(
            'Category is required for changeCategory action',
          );
        }
        const res = await this.subscriptionModel
          .updateMany(validFilter, { $set: { category: dto.category } })
          .exec();
        success = res.matchedCount;
        break;
      }
    }

    this.logger.log(
      { householdId, action: dto.action, count: success },
      'Bulk operation completed',
    );

    return { success, failed: dto.ids.length - success };
  }

  private escapeCsvField(field: string): string {
    if (
      field.includes(',') ||
      field.includes('"') ||
      field.includes('\n') ||
      field.includes('\r')
    ) {
      return `"${field.replace(/"/g, '""')}"`;
    }
    return field;
  }

  async exportCsv(
    householdId: string,
    query: QuerySubscriptionDto,
  ): Promise<string> {
    const { data } = await this.findAll(householdId, { ...query, limit: 0 });

    const header =
      'Name,Cost,Billing Cycle,Category,Next Billing Date,Status,Notes,Tags,Trial End Date,Shared With';
    const rows = data.map((sub) => {
      const date = sub.nextBillingDate
        ? new Date(sub.nextBillingDate).toISOString().split('T')[0]
        : '';
      const trialDate = sub.trialEndDate
        ? new Date(sub.trialEndDate).toISOString().split('T')[0]
        : '';
      return [
        this.escapeCsvField(sub.name),
        sub.cost.toString(),
        sub.billingCycle,
        this.escapeCsvField(sub.category || ''),
        date,
        sub.isActive ? 'Active' : 'Inactive',
        this.escapeCsvField(sub.notes || ''),
        this.escapeCsvField((sub.tags || []).join('; ')),
        trialDate,
        sub.sharedWith != null ? sub.sharedWith.toString() : '',
      ].join(',');
    });

    return [header, ...rows].join('\n');
  }

  /**
   * Delete every subscription belonging to a household. The household-scoped
   * deletion cascade primitive (e.g. for household teardown). User deletion no
   * longer cascades here — household data is shared and outlives a single
   * member (see UsersService.remove).
   */
  async removeAllByHouseholdId(householdId: string): Promise<number> {
    const result = await this.subscriptionModel
      .deleteMany({ householdId: new Types.ObjectId(householdId) } as Record<
        string,
        unknown
      >)
      .exec();
    return result.deletedCount;
  }
}
