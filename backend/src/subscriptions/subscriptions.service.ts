import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
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
  private advanceCooldowns = new Map<string, number>();
  static ADVANCE_COOLDOWN_MS = 60_000;

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

  async advanceOverdueDates(userId: string): Promise<void> {
    const now = new Date();
    const overdue = await this.subscriptionModel
      .find({
        userId: new Types.ObjectId(userId),
        isActive: true,
        nextBillingDate: { $lte: now },
      } as Record<string, unknown>)
      .exec();

    if (overdue.length === 0) return;

    const bulkOps = overdue.map((sub) => {
      const newDate = SubscriptionsService.advanceToFutureDate(
        sub.nextBillingDate,
        sub.billingCycle,
        now,
      );
      return {
        updateOne: {
          filter: {
            _id: sub._id,
            nextBillingDate: { $lte: now },
          },
          update: { $set: { nextBillingDate: newDate } },
        },
      };
    });

    await this.subscriptionModel.bulkWrite(bulkOps);
  }

  async create(
    userId: string,
    createDto: CreateSubscriptionDto,
  ): Promise<SubscriptionDocument> {
    const subscription = new this.subscriptionModel({
      ...createDto,
      userId: new Types.ObjectId(userId),
    });
    const saved = await subscription.save();
    this.logger.log(
      { userId, subscriptionId: saved._id.toString() },
      'Subscription created',
    );
    return saved;
  }

  async findAll(
    userId: string,
    query: QuerySubscriptionDto,
  ): Promise<PaginatedSubscriptions> {
    const lastAdvance = this.advanceCooldowns.get(userId) ?? 0;
    const now = Date.now();
    if (now - lastAdvance >= SubscriptionsService.ADVANCE_COOLDOWN_MS) {
      this.advanceCooldowns.set(userId, now);
      await this.advanceOverdueDates(userId);
    }

    const filter: Record<string, unknown> = {
      userId: new Types.ObjectId(userId),
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

  async findOne(userId: string, id: string): Promise<SubscriptionDocument> {
    const subscription = await this.subscriptionModel.findById(id).exec();
    if (
      !subscription ||
      !subscription.userId ||
      !new Types.ObjectId(userId).equals(
        subscription.userId as unknown as Types.ObjectId,
      )
    ) {
      throw new NotFoundException(`Subscription with ID "${id}" not found`);
    }
    return subscription;
  }

  async update(
    userId: string,
    id: string,
    updateDto: UpdateSubscriptionDto,
  ): Promise<SubscriptionDocument> {
    const existing = await this.findOne(userId, id);
    Object.assign(existing, updateDto);
    const saved = await existing.save();
    this.logger.log({ userId, subscriptionId: id }, 'Subscription updated');
    return saved;
  }

  async remove(userId: string, id: string): Promise<void> {
    const deleted = await this.subscriptionModel
      .findOneAndDelete({
        _id: new Types.ObjectId(id),
        userId: new Types.ObjectId(userId),
      } as Record<string, unknown>)
      .exec();

    if (!deleted) {
      throw new NotFoundException(`Subscription with ID "${id}" not found`);
    }
    this.logger.log({ userId, subscriptionId: id }, 'Subscription deleted');
  }

  async bulkOperation(
    userId: string,
    dto: BulkOperationDto,
  ): Promise<BulkOperationResult> {
    const ids = dto.ids.map((id) => new Types.ObjectId(id));
    const filter = {
      _id: { $in: ids },
      userId: new Types.ObjectId(userId),
    } as Record<string, unknown>;

    const validDocs = await this.subscriptionModel.find(filter).exec();
    const validIds = validDocs.map((doc) => doc._id);
    const failed = dto.ids.length - validIds.length;

    if (validIds.length === 0) {
      return { success: 0, failed };
    }

    const validFilter = {
      _id: { $in: validIds },
      userId: new Types.ObjectId(userId),
    } as Record<string, unknown>;

    switch (dto.action) {
      case BulkAction.DELETE:
        await this.subscriptionModel.deleteMany(validFilter).exec();
        break;
      case BulkAction.ACTIVATE:
        await this.subscriptionModel
          .updateMany(validFilter, { $set: { isActive: true } })
          .exec();
        break;
      case BulkAction.DEACTIVATE:
        await this.subscriptionModel
          .updateMany(validFilter, { $set: { isActive: false } })
          .exec();
        break;
      case BulkAction.CHANGE_CATEGORY:
        if (!dto.category) {
          throw new BadRequestException(
            'Category is required for changeCategory action',
          );
        }
        await this.subscriptionModel
          .updateMany(validFilter, { $set: { category: dto.category } })
          .exec();
        break;
    }

    this.logger.log(
      { userId, action: dto.action, count: validIds.length },
      'Bulk operation completed',
    );

    return { success: validIds.length, failed };
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
    userId: string,
    query: QuerySubscriptionDto,
  ): Promise<string> {
    const { data } = await this.findAll(userId, { ...query, limit: 0 });

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

  async removeAllByUserId(userId: string): Promise<number> {
    const result = await this.subscriptionModel
      .deleteMany({ userId: new Types.ObjectId(userId) } as Record<
        string,
        unknown
      >)
      .exec();
    return result.deletedCount;
  }

  async migrateUnownedSubscriptions(adminUserId: string): Promise<number> {
    const result = await this.subscriptionModel
      .updateMany({ userId: { $exists: false } } as Record<string, unknown>, {
        $set: { userId: new Types.ObjectId(adminUserId) },
      })
      .exec();
    return result.modifiedCount;
  }
}
