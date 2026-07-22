import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BillingCycle } from './schemas/subscription.schema';
import {
  RecurringTransaction,
  RecurringTransactionDocument,
  RecurringType,
  RecurringCadence,
} from '../recurring/schemas/recurring-transaction.schema';
import { CategoriesService } from '../categories/categories.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';
import { QuerySubscriptionDto } from './dto/query-subscription.dto';
import { BulkOperationDto, BulkAction } from './dto/bulk-operation.dto';
import { PaginatedSubscriptions } from './interfaces/paginated-subscriptions.interface';
import { BulkOperationResult } from './interfaces/bulk-operation-result.interface';

/**
 * The legacy /api/subscriptions wire shape, projected from a RecurringTransaction
 * (VEG-469). Dollars/`billingCycle`/string-`category` live only at this boundary;
 * the store is integer cents / `cadence` / `categoryId` + verbatim
 * `subscriptionCategory`.
 */
export interface SubscriptionView {
  _id: Types.ObjectId;
  householdId: Types.ObjectId;
  memberId?: Types.ObjectId;
  name: string;
  cost: number;
  billingCycle: BillingCycle;
  nextBillingDate: Date;
  category: string;
  notes?: string;
  tags: string[];
  isActive: boolean;
  reminderDaysBefore: number;
  trialEndDate?: Date;
  sharedWith?: number | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The Subscriptions API, served over `RecurringTransaction` (the
 * `isSubscription: true` slice) — VEG-469. The wire contract is unchanged, so
 * the controller, the frontend, and the subscription suites are untouched; only
 * the storage moved. Every query is hard-scoped to `isSubscription: true` so the
 * subscriptions API can never read or mutate an ordinary bill/paycheck.
 */
@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    @InjectModel(RecurringTransaction.name)
    private readonly recurringModel: Model<RecurringTransactionDocument>,
    private readonly categoriesService: CategoriesService,
  ) {}

  private static getMonthlyCost(
    cost: number,
    billingCycle: BillingCycle,
  ): number {
    if (billingCycle === BillingCycle.WEEKLY) return cost * 4.33;
    return billingCycle === BillingCycle.YEARLY ? cost / 12 : cost;
  }

  /** Escape user input so it matches literally in a RegExp (no ReDoS/injection). */
  private static escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private baseFilter(householdId: string): Record<string, unknown> {
    return {
      householdId: new Types.ObjectId(householdId),
      isSubscription: true,
    };
  }

  private toView(doc: RecurringTransactionDocument): SubscriptionView {
    return {
      _id: doc._id,
      householdId: doc.householdId as unknown as Types.ObjectId,
      memberId: doc.memberId as unknown as Types.ObjectId | undefined,
      name: doc.payee,
      cost: doc.amountCents / 100,
      // BillingCycle and RecurringCadence share identical string values.
      billingCycle: doc.cadence as unknown as BillingCycle,
      nextBillingDate: doc.nextDate,
      category: doc.subscriptionCategory ?? '',
      notes: doc.notes,
      tags: doc.tags ?? [],
      isActive: doc.isActive,
      reminderDaysBefore: doc.reminderDaysBefore,
      trialEndDate: doc.trialEndDate,
      sharedWith: doc.sharedWith ?? null,
      createdAt: (doc as unknown as { createdAt: Date }).createdAt,
      updatedAt: (doc as unknown as { updatedAt: Date }).updatedAt,
    };
  }

  // Best-effort budgeting link for the legacy free-text category string: exact
  // name match, else the seeded "Subscriptions" category, else the generic
  // fallback. The verbatim string is stored separately (subscriptionCategory),
  // so this never changes what the user sees — it only links the budget view.
  private async resolveCategoryId(
    householdId: string,
    category: string,
  ): Promise<Types.ObjectId> {
    const { byName, fallbackId } =
      await this.categoriesService.resolveImportCategories(householdId);
    const key = category?.trim().toLowerCase();
    const resolved =
      (key ? byName.get(key) : undefined) ??
      byName.get('subscriptions') ??
      fallbackId;
    if (!resolved) {
      // Households are always seeded with categories; a null fallback means an
      // unseeded household, which shouldn't happen at a write path.
      throw new InternalServerErrorException(
        'Cannot resolve a category for the subscription',
      );
    }
    return resolved;
  }

  async create(
    householdId: string,
    memberId: string,
    createDto: CreateSubscriptionDto,
  ): Promise<SubscriptionView> {
    const categoryId = await this.resolveCategoryId(
      householdId,
      createDto.category,
    );

    const doc = new this.recurringModel({
      householdId: new Types.ObjectId(householdId),
      memberId: new Types.ObjectId(memberId),
      type: RecurringType.EXPENSE,
      isSubscription: true,
      amountCents: Math.round(createDto.cost * 100),
      payee: createDto.name,
      cadence: createDto.billingCycle as unknown as RecurringCadence,
      nextDate: new Date(createDto.nextBillingDate),
      categoryId,
      subscriptionCategory: createDto.category,
      notes: createDto.notes,
      tags: createDto.tags ?? [],
      reminderDaysBefore: createDto.reminderDaysBefore ?? 3,
      isActive: createDto.isActive ?? true,
      sharedWith: createDto.sharedWith ?? undefined,
      trialEndDate: createDto.trialEndDate
        ? new Date(createDto.trialEndDate)
        : undefined,
    });
    const saved = await doc.save();
    this.logger.log(
      { householdId, memberId, subscriptionId: saved._id.toString() },
      'Subscription created',
    );
    return this.toView(saved);
  }

  async findAll(
    householdId: string,
    query: QuerySubscriptionDto,
  ): Promise<PaginatedSubscriptions> {
    const filter = this.baseFilter(householdId);

    if (query.category) {
      filter.subscriptionCategory = query.category;
    }
    if (query.billingCycle) {
      filter.cadence = query.billingCycle;
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
    if (query.search?.trim()) {
      const regex = new RegExp(
        SubscriptionsService.escapeRegex(query.search.trim()),
        'i',
      );
      filter.$or = [{ payee: regex }, { notes: regex }];
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = limit === 0 ? 0 : (page - 1) * limit;

    const total = await this.recurringModel.countDocuments(filter).exec();

    const sortBy = query.sortBy || 'createdAt';
    const sortOrder = query.sortOrder === 'asc' ? 1 : -1;

    let views: SubscriptionView[];

    if (sortBy === 'cost') {
      // Normalized-to-monthly sort, in-memory (matches the legacy semantics).
      const docs = await this.recurringModel.find(filter).exec();
      const mapped = docs.map((d) => this.toView(d));
      const sorted = mapped.sort((a, b) => {
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
      views = limit === 0 ? sorted : sorted.slice(skip, skip + limit);
    } else {
      // Translate the legacy sort keys to the recurring field names.
      const sortField =
        sortBy === 'name'
          ? 'payee'
          : sortBy === 'nextBillingDate'
            ? 'nextDate'
            : 'createdAt';
      const q = this.recurringModel
        .find(filter)
        .sort({ [sortField]: sortOrder });
      if (limit !== 0) {
        q.skip(skip).limit(limit);
      }
      const docs = await q.exec();
      views = docs.map((d) => this.toView(d));
    }

    const totalPages = limit === 0 ? 1 : Math.ceil(total / limit);
    const hasNextPage = limit === 0 ? false : page < totalPages;

    return {
      // The controller serializes these plain objects identically to the old
      // Mongoose docs; the interface type is a structural match.
      data: views as unknown as PaginatedSubscriptions['data'],
      meta: { total, page, limit, totalPages, hasNextPage },
    };
  }

  private async findDoc(
    householdId: string,
    id: string,
  ): Promise<RecurringTransactionDocument> {
    const doc = await this.recurringModel.findById(id).exec();
    if (
      !doc ||
      !doc.isSubscription ||
      !doc.householdId ||
      !new Types.ObjectId(householdId).equals(
        doc.householdId as unknown as Types.ObjectId,
      )
    ) {
      throw new NotFoundException(`Subscription with ID "${id}" not found`);
    }
    return doc;
  }

  async findOne(householdId: string, id: string): Promise<SubscriptionView> {
    return this.toView(await this.findDoc(householdId, id));
  }

  async update(
    householdId: string,
    id: string,
    updateDto: UpdateSubscriptionDto,
  ): Promise<SubscriptionView> {
    const doc = await this.findDoc(householdId, id);

    if (updateDto.name !== undefined) doc.payee = updateDto.name;
    if (updateDto.cost !== undefined) {
      doc.amountCents = Math.round(updateDto.cost * 100);
    }
    if (updateDto.billingCycle !== undefined) {
      doc.cadence = updateDto.billingCycle as unknown as RecurringCadence;
    }
    if (updateDto.nextBillingDate !== undefined) {
      doc.nextDate = new Date(updateDto.nextBillingDate);
    }
    if (updateDto.category !== undefined) {
      doc.subscriptionCategory = updateDto.category;
      doc.categoryId = (await this.resolveCategoryId(
        householdId,
        updateDto.category,
      )) as unknown as typeof doc.categoryId;
    }
    if (updateDto.notes !== undefined) doc.notes = updateDto.notes;
    if (updateDto.tags !== undefined) doc.tags = updateDto.tags;
    if (updateDto.isActive !== undefined) doc.isActive = updateDto.isActive;
    if (updateDto.reminderDaysBefore !== undefined) {
      doc.reminderDaysBefore = updateDto.reminderDaysBefore;
    }
    if (updateDto.trialEndDate !== undefined) {
      doc.trialEndDate = updateDto.trialEndDate
        ? new Date(updateDto.trialEndDate)
        : undefined;
    }
    if (updateDto.sharedWith !== undefined) {
      doc.sharedWith = updateDto.sharedWith ?? undefined;
    }

    const saved = await doc.save();
    this.logger.log(
      { householdId, subscriptionId: id },
      'Subscription updated',
    );
    return this.toView(saved);
  }

  async remove(householdId: string, id: string): Promise<void> {
    const deleted = await this.recurringModel
      .findOneAndDelete({
        _id: new Types.ObjectId(id),
        householdId: new Types.ObjectId(householdId),
        isSubscription: true,
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
      ...this.baseFilter(householdId),
      _id: { $in: ids },
    } as Record<string, unknown>;

    const validDocs = await this.recurringModel
      .find(filter)
      .select('_id')
      .exec();
    const validIds = validDocs.map((doc) => doc._id);

    if (validIds.length === 0) {
      return { success: 0, failed: dto.ids.length };
    }

    const validFilter = {
      ...this.baseFilter(householdId),
      _id: { $in: validIds },
    } as Record<string, unknown>;

    let success = 0;
    switch (dto.action) {
      case BulkAction.DELETE: {
        const res = await this.recurringModel.deleteMany(validFilter).exec();
        success = res.deletedCount;
        break;
      }
      case BulkAction.ACTIVATE: {
        const res = await this.recurringModel
          .updateMany(validFilter, { $set: { isActive: true } })
          .exec();
        success = res.matchedCount;
        break;
      }
      case BulkAction.DEACTIVATE: {
        const res = await this.recurringModel
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
        // Store the verbatim string and re-link the budgeting category.
        const categoryId = await this.resolveCategoryId(
          householdId,
          dto.category,
        );
        const res = await this.recurringModel
          .updateMany(validFilter, {
            $set: { subscriptionCategory: dto.category, categoryId },
          })
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
    const subs = data as unknown as SubscriptionView[];

    const header =
      'Name,Cost,Billing Cycle,Category,Next Billing Date,Status,Notes,Tags,Trial End Date,Shared With';
    const rows = subs.map((sub) => {
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
   * Delete every subscription belonging to a household (the household-teardown
   * cascade primitive). Scoped to the `isSubscription` slice so it never touches
   * ordinary recurring schedules.
   */
  async removeAllByHouseholdId(householdId: string): Promise<number> {
    const result = await this.recurringModel
      .deleteMany(this.baseFilter(householdId))
      .exec();
    return result.deletedCount;
  }
}
