import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BillingCycle } from './billing-cycle.enum';
import {
  RecurringTransaction,
  RecurringTransactionDocument,
  RecurringType,
  RecurringCadence,
} from '../recurring/schemas/recurring-transaction.schema';
import { CategoriesService } from '../categories/categories.service';
import { AccountsService } from '../accounts/accounts.service';
import { AccountDocument } from '../accounts/schemas/account.schema';
import { settleTrackedSubscriptionDate } from '../recurring/recurring-dates.util';
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
  accountId: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The Subscriptions API, served over `RecurringTransaction` (the
 * `isSubscription: true` slice) — VEG-469. Every query is hard-scoped to
 * `isSubscription: true` so the subscriptions API can never read or mutate an
 * ordinary bill/paycheck.
 */
@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    @InjectModel(RecurringTransaction.name)
    private readonly recurringModel: Model<RecurringTransactionDocument>,
    private readonly categoriesService: CategoriesService,
    private readonly accountsService: AccountsService,
  ) {}

  private static getMonthlyCost(
    cost: number,
    billingCycle: BillingCycle,
  ): number {
    if (billingCycle === BillingCycle.WEEKLY) return cost * 4.33;
    return billingCycle === BillingCycle.YEARLY ? cost / 12 : cost;
  }

  // Monthly and yearly schedules remember their intended day-of-month so a
  // clamp to a short month is temporary. Weekly has no day-of-month identity.
  private static anchorDayFor(
    cadence: RecurringCadence,
    nextDate: Date,
  ): number | undefined {
    return cadence === RecurringCadence.WEEKLY
      ? undefined
      : nextDate.getUTCDate();
  }

  // A subscription that can post never saves a past nextDate. The rule and
  // its reasons live with settleTrackedSubscriptionDate, which
  // RecurringService.update applies to /api/recurring as well.
  private static settleTrackedDate(
    doc: RecurringTransactionDocument,
    now: Date,
  ): void {
    doc.nextDate = settleTrackedSubscriptionDate(doc, now);
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
      accountId:
        (doc.accountId as unknown as Types.ObjectId | undefined) ?? null,
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

  // A subscription's ledger account must live in this household and accept new
  // activity. A missing or foreign account is a client error (400), not a 404,
  // because the subscription is what the request creates or updates. This
  // mirrors RecurringService.assertAccountUsable.
  // `reactivating` only rewords the archived message: on PATCH
  // { isActive: true } the client never sent an accountId.
  private async assertAccountUsable(
    householdId: string,
    accountId: string,
    { reactivating = false }: { reactivating?: boolean } = {},
  ): Promise<void> {
    let account: AccountDocument;
    try {
      account = await this.accountsService.findOne(householdId, accountId);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw new BadRequestException(
          `accountId "${accountId}" does not reference an account in this household`,
        );
      }
      throw error;
    }
    if (account.isArchived) {
      throw new BadRequestException(
        reactivating
          ? 'Cannot reactivate a subscription whose account is archived'
          : 'Cannot track a subscription in an archived account',
      );
    }
  }

  // Transaction.amountCents has min 1, so a $0 subscription with an account
  // would fail every nightly materialization. Reject the pairing up front.
  private assertLedgerable(
    amountCents: number,
    accountId: Types.ObjectId | undefined,
  ): void {
    if (accountId && amountCents === 0) {
      throw new BadRequestException(
        'A free subscription cannot be tracked in an account. Set a cost above $0 or leave the account empty.',
      );
    }
  }

  async create(
    householdId: string,
    memberId: string,
    createDto: CreateSubscriptionDto,
    now: Date = new Date(),
  ): Promise<SubscriptionView> {
    const accountId =
      typeof createDto.accountId === 'string'
        ? new Types.ObjectId(createDto.accountId)
        : undefined;
    const amountCents = Math.round(createDto.cost * 100);
    this.assertLedgerable(amountCents, accountId);
    if (typeof createDto.accountId === 'string') {
      await this.assertAccountUsable(householdId, createDto.accountId);
    }

    const categoryId = await this.resolveCategoryId(
      householdId,
      createDto.category,
    );

    const cadence = createDto.billingCycle as unknown as RecurringCadence;
    const nextDate = new Date(createDto.nextBillingDate);
    const doc = new this.recurringModel({
      householdId: new Types.ObjectId(householdId),
      memberId: new Types.ObjectId(memberId),
      type: RecurringType.EXPENSE,
      isSubscription: true,
      amountCents,
      accountId,
      payee: createDto.name,
      cadence,
      nextDate,
      cadenceAnchorDay: SubscriptionsService.anchorDayFor(cadence, nextDate),
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
    SubscriptionsService.settleTrackedDate(doc, now);
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
      data: views,
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
    now: Date = new Date(),
  ): Promise<SubscriptionView> {
    const doc = await this.findDoc(householdId, id);

    // Validate the merged ledger state before mutating anything, so a rejected
    // patch leaves the document untouched.
    const currentAccountId = doc.accountId as unknown as
      | Types.ObjectId
      | undefined;
    const nextAmountCents =
      updateDto.cost !== undefined
        ? Math.round(updateDto.cost * 100)
        : doc.amountCents;
    const nextAccountId =
      typeof updateDto.accountId === 'string'
        ? new Types.ObjectId(updateDto.accountId)
        : updateDto.accountId === null
          ? undefined
          : currentAccountId;

    let accountChecked = false;
    if (
      typeof updateDto.accountId === 'string' &&
      updateDto.accountId.toLowerCase() !== currentAccountId?.toString()
    ) {
      await this.assertAccountUsable(householdId, updateDto.accountId);
      accountChecked = true;
    }
    // Reactivation must not resume posting to an archived account. The
    // recurring API applies the same rule to ordinary schedules.
    if (
      updateDto.isActive === true &&
      !doc.isActive &&
      nextAccountId &&
      !accountChecked
    ) {
      await this.assertAccountUsable(householdId, nextAccountId.toString(), {
        reactivating: true,
      });
    }
    this.assertLedgerable(nextAmountCents, nextAccountId);

    if (updateDto.name !== undefined) doc.payee = updateDto.name;
    if (updateDto.cost !== undefined) doc.amountCents = nextAmountCents;
    if (updateDto.billingCycle !== undefined) {
      doc.cadence = updateDto.billingCycle as unknown as RecurringCadence;
    }
    if (updateDto.nextBillingDate !== undefined) {
      doc.nextDate = new Date(updateDto.nextBillingDate);
    }
    // Re-anchor only when the date or cycle moves, as RecurringService.update
    // does. Re-deriving on every patch would rewrite the anchor from an
    // already-clamped date and bring back month-end drift.
    if (
      updateDto.nextBillingDate !== undefined ||
      updateDto.billingCycle !== undefined
    ) {
      doc.cadenceAnchorDay = SubscriptionsService.anchorDayFor(
        doc.cadence,
        doc.nextDate,
      );
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
    if (updateDto.accountId !== undefined) {
      doc.accountId = nextAccountId as unknown as typeof doc.accountId;
    }
    SubscriptionsService.settleTrackedDate(doc, now);

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
    now: Date = new Date(),
  ): Promise<BulkOperationResult> {
    const ids = dto.ids.map((id) => new Types.ObjectId(id));
    const filter = {
      ...this.baseFilter(householdId),
      _id: { $in: ids },
    } as Record<string, unknown>;

    const validDocs = await this.recurringModel
      .find(filter)
      .select('_id accountId nextDate cadence cadenceAnchorDay isActive')
      .exec();
    let validIds = validDocs.map((doc) => doc._id);

    if (dto.action === BulkAction.ACTIVATE) {
      validIds = await this.activatableIds(householdId, validDocs);
    }

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
        success = await this.bulkActivate(
          householdId,
          validDocs,
          validIds,
          now,
        );
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

  // Bulk activate follows the same rule as PATCH { isActive: true }: a
  // subscription tracked in a missing or archived account stays paused, so it
  // cannot resume posting there. Each distinct account is looked up once.
  private async activatableIds(
    householdId: string,
    docs: RecurringTransactionDocument[],
  ): Promise<Types.ObjectId[]> {
    const usable = new Map<string, boolean>();
    for (const doc of docs) {
      const accountId = (
        doc.accountId as unknown as Types.ObjectId | undefined
      )?.toString();
      if (!accountId || usable.has(accountId)) continue;
      try {
        const account = await this.accountsService.findOne(
          householdId,
          accountId,
        );
        usable.set(accountId, !account.isArchived);
      } catch (error) {
        if (!(error instanceof NotFoundException)) throw error;
        usable.set(accountId, false);
      }
    }
    return docs
      .filter((doc) => {
        const accountId = (
          doc.accountId as unknown as Types.ObjectId | undefined
        )?.toString();
        return !accountId || usable.get(accountId) === true;
      })
      .map((doc) => doc._id);
  }

  // Activating a tracked subscription is the moment it can post, so it obeys
  // the same no-backfill rule as update (see settleTrackedSubscriptionDate).
  // Each tracked subscription with a past date gets its own rolled date in the
  // same write that activates it, guarded on the nextDate this request read,
  // as RecurringService.advanceSchedule does. If the cron advanced it in
  // between, the write misses and the subscription counts as failed instead
  // of having a newer date overwritten. The rest flip in one updateMany.
  private async bulkActivate(
    householdId: string,
    docs: RecurringTransactionDocument[],
    ids: Types.ObjectId[],
    now: Date,
  ): Promise<number> {
    const activatable = new Set(ids.map(String));
    const rolled: { _id: Types.ObjectId; observed: Date; nextDate: Date }[] =
      [];
    const plain: Types.ObjectId[] = [];
    for (const doc of docs) {
      if (!activatable.has(String(doc._id))) continue;
      // Settle as the activated state: the flip is what makes it able to post.
      const nextDate = settleTrackedSubscriptionDate(
        {
          isSubscription: true,
          accountId: doc.accountId,
          isActive: true,
          nextDate: doc.nextDate,
          cadence: doc.cadence,
          cadenceAnchorDay: doc.cadenceAnchorDay,
        },
        now,
      );
      if (nextDate !== doc.nextDate) {
        rolled.push({ _id: doc._id, observed: doc.nextDate, nextDate });
      } else {
        plain.push(doc._id);
      }
    }

    let matched = 0;
    if (rolled.length > 0) {
      const res = await this.recurringModel.bulkWrite(
        rolled.map(({ _id, observed, nextDate }) => ({
          updateOne: {
            filter: {
              ...this.baseFilter(householdId),
              _id,
              nextDate: observed,
            } as Record<string, unknown>,
            update: { $set: { isActive: true, nextDate } },
          },
        })),
      );
      matched += res.matchedCount;
    }
    if (plain.length > 0) {
      const res = await this.recurringModel
        .updateMany(
          {
            ...this.baseFilter(householdId),
            _id: { $in: plain },
          } as Record<string, unknown>,
          { $set: { isActive: true } },
        )
        .exec();
      matched += res.matchedCount;
    }
    return matched;
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
    const { data: subs } = await this.findAll(householdId, {
      ...query,
      limit: 0,
    });

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
