import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CategoriesService } from '../categories/categories.service';
import {
  Subscription,
  SubscriptionDocument,
} from './schemas/subscription.schema';
import {
  RecurringTransaction,
  RecurringTransactionDocument,
  RecurringType,
  RecurringCadence,
} from '../recurring/schemas/recurring-transaction.schema';

export interface FoldInSummary {
  scanned: number;
  folded: number;
  /** Already present in recurring (a prior run inserted but died before stamping). */
  alreadyMigrated: number;
  /** Left unstamped for a later retry (no household, or no category resolvable). */
  skipped: number;
  /** Abandoned after an unexpected error; the rest still ran. */
  failed: number;
}

// The lean legacy row. `.lean()` returns the raw stored doc, including the
// pre-household `userId` on un-stamped rows (not modelled here — the
// households-migration stamps householdId first).
interface LegacySubscription {
  _id: Types.ObjectId;
  householdId?: Types.ObjectId;
  memberId?: Types.ObjectId;
  name: string;
  cost: number;
  billingCycle: string;
  nextBillingDate: Date;
  category: string;
  notes?: string;
  tags?: string[];
  isActive?: boolean;
  reminderDaysBefore?: number;
  trialEndDate?: Date;
  sharedWith?: number | null;
  createdAt: Date;
  updatedAt: Date;
}

type ResolvedCategories = {
  byName: Map<string, Types.ObjectId>;
  fallbackId: Types.ObjectId | null;
};

function isDuplicateKeyError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as { code?: number }).code === 11000
  );
}

/**
 * One-time, idempotent migration folding legacy `Subscription` docs into
 * `RecurringTransaction`s (`isSubscription: true, type: expense`) — VEG-469.
 * Mirrors the households-migration pattern: cursor scan, per-doc isolation,
 * counted summary.
 *
 * Idempotency authority is the source stamp `Subscription.migratedAt`: the scan
 * filter excludes stamped rows, so a re-run inserts nothing, and a user
 * deleting the migrated recurring doc afterwards is NOT resurrected. The
 * recurring doc is inserted with the subscription's own `_id`, which keeps
 * `Notification.subscriptionId` references and `/subscriptions/:id/edit` URLs
 * valid across the cutover with no id remap.
 *
 * Registered but NOT invoked yet (VEG-469 PR1): the boot wiring lands with the
 * controller/cron flip in PR2.
 */
@Injectable()
export class SubscriptionsFoldInService {
  private readonly logger = new Logger(SubscriptionsFoldInService.name);

  constructor(
    @InjectModel(Subscription.name)
    private readonly subscriptionModel: Model<SubscriptionDocument>,
    @InjectModel(RecurringTransaction.name)
    private readonly recurringModel: Model<RecurringTransactionDocument>,
    private readonly categoriesService: CategoriesService,
  ) {}

  async foldInSubscriptions(): Promise<FoldInSummary> {
    const summary: FoldInSummary = {
      scanned: 0,
      folded: 0,
      alreadyMigrated: 0,
      skipped: 0,
      failed: 0,
    };
    // resolveImportCategories is one query per household; cache across the run.
    const categoryCache = new Map<string, ResolvedCategories>();

    const cursor = this.subscriptionModel
      .find({ migratedAt: { $exists: false } } as Record<string, unknown>)
      .lean()
      .cursor();

    for await (const raw of cursor) {
      const sub = raw as unknown as LegacySubscription;
      summary.scanned += 1;
      try {
        // Pre-household rows the households-migration hasn't stamped yet are
        // invisible to the app anyway; leave them unstamped to retry next boot.
        if (!sub.householdId) {
          summary.skipped += 1;
          this.logger.warn(
            { subscriptionId: sub._id.toString() },
            'Skipping fold-in: subscription has no householdId',
          );
          continue;
        }
        const householdId = sub.householdId.toString();

        let resolved = categoryCache.get(householdId);
        if (!resolved) {
          resolved =
            await this.categoriesService.resolveImportCategories(householdId);
          categoryCache.set(householdId, resolved);
        }
        const categoryId = this.resolveCategoryId(sub.category, resolved);
        if (!categoryId) {
          // Household somehow has no categories (unseeded); leave unstamped so
          // a later boot (after category backfill) retries it.
          summary.failed += 1;
          this.logger.error(
            { subscriptionId: sub._id.toString(), householdId },
            'Fold-in failed: no category resolvable (household has no categories)',
          );
          continue;
        }

        const inserted = await this.insertRecurring(sub, categoryId);
        if (inserted) {
          summary.folded += 1;
        } else {
          summary.alreadyMigrated += 1;
        }

        // Stamp the source last: if a crash lands between insert and stamp, the
        // re-run's insert hits a duplicate _id (handled as alreadyMigrated) and
        // still stamps — no double-fold, no lost stamp.
        await this.subscriptionModel
          .updateOne({ _id: sub._id } as Record<string, unknown>, {
            $set: { migratedAt: new Date() },
          })
          .exec();
      } catch (error: unknown) {
        summary.failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          { subscriptionId: sub._id.toString() },
          `Fold-in failed for subscription: ${message}`,
        );
      }
    }

    if (summary.folded > 0 || summary.failed > 0) {
      this.logger.log(summary, 'Subscriptions fold-in complete');
    }
    return summary;
  }

  // Map a legacy category string to a household categoryId: exact name match,
  // else the seeded "Subscriptions" category, else the generic fallback.
  private resolveCategoryId(
    category: string,
    resolved: ResolvedCategories,
  ): Types.ObjectId | null {
    const key = category?.trim().toLowerCase();
    return (
      (key ? resolved.byName.get(key) : undefined) ??
      resolved.byName.get('subscriptions') ??
      resolved.fallbackId
    );
  }

  // Insert the recurring doc, preserving the subscription's _id and timestamps.
  // Returns false if the doc already existed (a resumed crash) so the caller
  // still stamps the source.
  private async insertRecurring(
    sub: LegacySubscription,
    categoryId: Types.ObjectId,
  ): Promise<boolean> {
    const doc = new this.recurringModel({
      _id: sub._id,
      householdId: sub.householdId,
      memberId: sub.memberId,
      type: RecurringType.EXPENSE,
      isSubscription: true,
      // Dollars → integer cents; Math.round kills float artifacts (19.99 * 100
      // === 1998.9999…). cost 0 stays 0 (allowed for subscriptions).
      amountCents: Math.round(sub.cost * 100),
      payee: sub.name,
      // BillingCycle and RecurringCadence share identical string values.
      cadence: sub.billingCycle as RecurringCadence,
      nextDate: sub.nextBillingDate,
      categoryId,
      subscriptionCategory: sub.category,
      notes: sub.notes,
      tags: sub.tags ?? [],
      reminderDaysBefore: sub.reminderDaysBefore ?? 3,
      isActive: sub.isActive ?? true,
      sharedWith: sub.sharedWith ?? undefined,
      trialEndDate: sub.trialEndDate,
      // accountId omitted: subscriptions have no account. cadenceAnchorDay
      // omitted: absent means "use nextDate's day", matching legacy advancement.
    });
    // Preserve the original creation time so the subscriptions list default
    // order (createdAt desc) survives the fold-in.
    doc.set('createdAt', sub.createdAt);
    doc.set('updatedAt', sub.updatedAt);

    try {
      await doc.save({ timestamps: false });
      return true;
    } catch (error: unknown) {
      if (isDuplicateKeyError(error)) {
        return false;
      }
      throw error;
    }
  }
}
