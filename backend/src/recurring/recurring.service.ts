import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  RecurringCadence,
  RecurringTransaction,
  RecurringTransactionDocument,
  RecurringType,
} from './schemas/recurring-transaction.schema';
import { TransactionsService } from '../transactions/transactions.service';
import { TransactionType } from '../transactions/schemas/transaction.schema';
import { CreateRecurringDto } from './dto/create-recurring.dto';
import { UpdateRecurringDto } from './dto/update-recurring.dto';
import { QueryRecurringDto } from './dto/query-recurring.dto';
import { AccountsService } from '../accounts/accounts.service';
import type { AccountDocument } from '../accounts/schemas/account.schema';
import { CategoriesService } from '../categories/categories.service';
import { addCadence } from './recurring-dates.util';
import { parseUtcDate, utcDay } from '../common/utc-date.util';

// The merged, would-be-persisted state of a schedule's cross-field invariants,
// checked before any write so violations surface as 400s (the schema-level
// backstops would only fire at save time, as 500s).
interface ScheduleState {
  type: RecurringType;
  isSubscription: boolean;
  nextDate: Date;
  endDate?: Date;
}

/** What one scheduler run did, for the cron's summary log. */
export interface MaterializationSummary {
  scanned: number;
  materialized: number;
  /** Occurrences a previous run had already written (resumed after a crash). */
  duplicate: number;
  /** Schedules skipped for an unusable account/category, left un-advanced. */
  skipped: number;
  /** Schedules that reached their endDate and were deactivated. */
  deactivated: number;
  /**
   * Occurrences rolled forward WITHOUT posting to the ledger: account-less
   * subscriptions (VEG-469 fold-in) whose date must still advance the way the
   * retired subscription cron advanced them. Distinct from `materialized` so a
   * date-only roll is never mistaken for a ledger write.
   */
  advancedOnly: number;
  /** Schedules that hit MAX_CATCHUP_PERIODS and will resume tomorrow. */
  capped: number;
  /**
   * Schedules whose guarded advance matched nothing, so the remaining periods
   * were abandoned. Counted so a run that gave up mid-catch-up is
   * distinguishable from one that finished cleanly.
   */
  yielded: number;
  /** Schedules abandoned mid-run after an error; the rest still ran. */
  failed: number;
}

// The lean scan row. Narrower than the full document on purpose: the scan uses
// .lean(), so there is no save() and nothing here may be mutated in place.
interface DueSchedule {
  _id: Types.ObjectId;
  householdId: Types.ObjectId;
  accountId?: Types.ObjectId;
  categoryId: Types.ObjectId;
  memberId?: Types.ObjectId;
  type: RecurringType;
  amountCents: number;
  payee: string;
  notes?: string;
  tags: string[];
  cadence: RecurringCadence;
  nextDate: Date;
  cadenceAnchorDay?: number;
  endDate?: Date;
  // Account-less subscriptions advance their date without materializing (VEG-469).
  isSubscription: boolean;
}

// Whether a schedule's references allow it to post right now. A discriminated
// union rather than a boolean + optional: the usable branch carries the
// resolved accountId, so the materialization path can never need a non-null
// assertion on a field the schema marks optional.
type MaterializationRefs =
  | { usable: true; accountId: Types.ObjectId }
  | { usable: false; reason: string };

// RecurringType and TransactionType are deliberately distinct enums (recurring
// has no `transfer` case), so translate explicitly rather than casting. A cast
// would keep compiling — and silently mean the wrong thing — if either enum
// changed.
function toTransactionType(
  type: RecurringType,
): TransactionType.INCOME | TransactionType.EXPENSE {
  return type === RecurringType.INCOME
    ? TransactionType.INCOME
    : TransactionType.EXPENSE;
}

// Household-scoped CRUD for recurring schedules (VEG-466). The materialization
// scheduler (VEG-467) and reminders (VEG-468) build on the model and the
// { isActive, nextDate } index; the subscriptions fold-in (VEG-469) writes
// outside the ValidationPipe and leans on the schema-level validators as its
// backstop.
@Injectable()
export class RecurringService {
  private readonly logger = new Logger(RecurringService.name);

  constructor(
    @InjectModel(RecurringTransaction.name)
    private readonly recurringModel: Model<RecurringTransactionDocument>,
    private readonly accountsService: AccountsService,
    private readonly categoriesService: CategoriesService,
    private readonly transactionsService: TransactionsService,
  ) {}

  /**
   * How many periods one schedule may catch up in a single run. A schedule
   * left with a years-stale nextDate (a bad migration, a long-dormant row
   * reactivated) would otherwise mint hundreds of ledger entries and balance
   * deltas unattended. Hitting the cap is a data signal, not an outage signal:
   * 60 already absorbs ~14 months of downtime at the tightest cadence
   * (weekly), 5 years at monthly. Progress is persisted, so the next daily run
   * continues rather than restarting.
   */
  static readonly MAX_CATCHUP_PERIODS = 60;

  async create(
    householdId: string,
    memberId: string,
    dto: CreateRecurringDto,
  ): Promise<RecurringTransactionDocument> {
    // Parse once and reuse: the validated dates and the persisted dates must
    // be the same instants.
    const nextDate = parseUtcDate(dto.nextDate);
    const endDate = dto.endDate ? parseUtcDate(dto.endDate) : undefined;
    this.validateScheduleState({
      type: dto.type,
      isSubscription: dto.isSubscription ?? false,
      nextDate,
      endDate,
    });
    await Promise.all([
      this.assertAccountUsable(householdId, dto.accountId),
      this.assertCategoryUsable(householdId, dto.categoryId),
    ]);

    const created = await new this.recurringModel({
      householdId: new Types.ObjectId(householdId),
      accountId: new Types.ObjectId(dto.accountId),
      categoryId: new Types.ObjectId(dto.categoryId),
      memberId: memberId ? new Types.ObjectId(memberId) : undefined,
      type: dto.type,
      amountCents: dto.amountCents,
      payee: dto.payee,
      notes: dto.notes,
      // Leave omitted fields (tags, reminderDaysBefore, isActive,
      // isSubscription) undefined so the schema defaults apply.
      tags: dto.tags,
      cadence: dto.cadence,
      nextDate,
      // Server-derived, never client-supplied (absent from the DTO, so
      // whitelist:true strips any attempt). Anchoring on the creation date
      // keeps a later month-length clamp temporary — see the schema comment.
      cadenceAnchorDay: nextDate.getUTCDate(),
      reminderDaysBefore: dto.reminderDaysBefore,
      endDate,
      isActive: dto.isActive,
      isSubscription: dto.isSubscription,
      // Store null (the legacy "not shared" wire value) as unset.
      sharedWith: dto.sharedWith ?? undefined,
    }).save();

    this.logger.log(
      { householdId, recurringId: created._id.toString() },
      'Recurring schedule created',
    );
    return created;
  }

  async findAll(
    householdId: string,
    query: QueryRecurringDto,
  ): Promise<RecurringTransactionDocument[]> {
    const filter: Record<string, unknown> = {
      householdId: new Types.ObjectId(householdId),
    };
    if (query.type) {
      filter.type = query.type;
    }
    if (query.accountId) {
      filter.accountId = new Types.ObjectId(query.accountId);
    }
    if (query.categoryId) {
      filter.categoryId = new Types.ObjectId(query.categoryId);
    }
    if (query.isSubscription !== undefined) {
      filter.isSubscription = query.isSubscription;
    }
    if (query.isActive !== undefined) {
      filter.isActive = query.isActive;
    }
    // Upcoming-first; served by the { householdId, nextDate } index. No
    // pagination: a household's schedules are bounded by real-world bills,
    // the same cardinality as accounts/categories (which return arrays too).
    return this.recurringModel.find(filter).sort({ nextDate: 1 }).exec();
  }

  async findOne(
    householdId: string,
    id: string,
  ): Promise<RecurringTransactionDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`Recurring schedule "${id}" not found`);
    }
    const schedule = await this.recurringModel.findById(id).exec();
    if (
      !schedule ||
      !new Types.ObjectId(householdId).equals(
        schedule.householdId as unknown as Types.ObjectId,
      )
    ) {
      throw new NotFoundException(`Recurring schedule "${id}" not found`);
    }
    return schedule;
  }

  async update(
    householdId: string,
    id: string,
    dto: UpdateRecurringDto,
  ): Promise<RecurringTransactionDocument> {
    const existing = await this.findOne(householdId, id);

    const mergedNextDate =
      dto.nextDate !== undefined
        ? parseUtcDate(dto.nextDate)
        : existing.nextDate;
    const mergedEndDate =
      dto.endDate === undefined
        ? existing.endDate
        : dto.endDate === null
          ? undefined
          : parseUtcDate(dto.endDate);

    this.validateScheduleState(
      {
        type: dto.type ?? existing.type,
        isSubscription: dto.isSubscription ?? existing.isSubscription,
        nextDate: mergedNextDate,
        endDate: mergedEndDate,
      },
      // Only a patch that touches a date can create an impossible window; a
      // scheduler-completed doc (nextDate advanced past endDate, VEG-467)
      // must stay editable otherwise.
      { checkDates: dto.nextDate !== undefined || dto.endDate !== undefined },
    );

    // Re-validate a reference when it changes (re-pointing is held to the same
    // rules as a create) or when a paused schedule is being reactivated —
    // otherwise PATCH { isActive: true } would sneak new scheduler activity
    // onto an account/category archived while the schedule was paused.
    // Corrections to a schedule already sitting on an archived reference stay
    // allowed. Legacy docs (VEG-469) may have no accountId at all — optional
    // chaining keeps that safe. Ids compare case-insensitively: @IsMongoId
    // admits uppercase hex, and echoing the current reference uppercased
    // must not count as a re-point.
    const existingAccountId = (
      existing.accountId as unknown as Types.ObjectId | undefined
    )?.toString();
    const existingCategoryId = (
      existing.categoryId as unknown as Types.ObjectId
    ).toString();
    const reactivating = dto.isActive === true && !existing.isActive;
    // One rule for both reference types: validate the incoming id when it
    // actually changes, else re-validate the current id on reactivation.
    const referenceCheck = (
      dtoId: string | undefined,
      existingId: string | undefined,
      assert: (id: string, opts?: { reactivating: boolean }) => Promise<void>,
    ): Promise<void> | undefined => {
      if (dtoId !== undefined && dtoId.toLowerCase() !== existingId) {
        return assert(dtoId);
      }
      if (reactivating && existingId) {
        return assert(existingId, { reactivating: true });
      }
      return undefined;
    };
    await Promise.all([
      referenceCheck(dto.accountId, existingAccountId, (accId, opts) =>
        this.assertAccountUsable(householdId, accId, opts),
      ),
      referenceCheck(dto.categoryId, existingCategoryId, (catId, opts) =>
        this.assertCategoryUsable(householdId, catId, opts),
      ),
    ]);

    if (dto.accountId !== undefined) {
      existing.accountId = new Types.ObjectId(
        dto.accountId,
      ) as unknown as typeof existing.accountId;
    }
    if (dto.categoryId !== undefined) {
      existing.categoryId = new Types.ObjectId(
        dto.categoryId,
      ) as unknown as typeof existing.categoryId;
    }
    if (dto.type !== undefined) existing.type = dto.type;
    if (dto.amountCents !== undefined) existing.amountCents = dto.amountCents;
    if (dto.payee !== undefined) existing.payee = dto.payee;
    if (dto.notes !== undefined) existing.notes = dto.notes;
    if (dto.tags !== undefined) existing.tags = dto.tags;
    if (dto.cadence !== undefined) {
      existing.cadence = dto.cadence;
      // Changing cadence re-anchors off the current nextDate, unless the patch
      // also sets one explicitly (handled below). A weekly schedule's nextDate
      // walks forward every run while its anchor stays frozen at the creation
      // day — addCadence ignores the anchor for weekly — so carrying that
      // stale value into monthly/yearly would hand it authority over the
      // posting date it never had.
      if (dto.nextDate === undefined) {
        existing.cadenceAnchorDay = existing.nextDate.getUTCDate();
      }
    }
    if (dto.nextDate !== undefined) {
      existing.nextDate = mergedNextDate;
      // Moving the date IS re-anchoring — but only then. Re-deriving on every
      // patch would let an unrelated edit rewrite the anchor from an
      // already-clamped nextDate, reintroducing the drift the field prevents.
      existing.cadenceAnchorDay = mergedNextDate.getUTCDate();
    }
    if (dto.reminderDaysBefore !== undefined) {
      existing.reminderDaysBefore = dto.reminderDaysBefore;
    }
    if (dto.endDate !== undefined) existing.endDate = mergedEndDate;
    if (dto.isActive !== undefined) existing.isActive = dto.isActive;
    if (dto.isSubscription !== undefined) {
      existing.isSubscription = dto.isSubscription;
    }
    if (dto.sharedWith !== undefined) {
      // Null-to-clear: store as unset rather than a persisted null.
      existing.sharedWith = dto.sharedWith ?? undefined;
    }

    // Save via the document, never findOneAndUpdate: the schema's
    // isSubscription cross-field validator only runs on the save path.
    const saved = await existing.save();
    this.logger.log(
      { householdId, recurringId: id },
      'Recurring schedule updated',
    );
    return saved;
  }

  async remove(householdId: string, id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`Recurring schedule "${id}" not found`);
    }
    // One atomic household-scoped delete: the filter IS the tenancy check
    // (missing and cross-household both come back deletedCount 0 → 404).
    // Materialized Transactions keep their recurringId — deleting the
    // schedule never touches the ledger.
    const result = await this.recurringModel
      .deleteOne({
        _id: new Types.ObjectId(id),
        householdId: new Types.ObjectId(householdId),
      } as Record<string, unknown>)
      .exec();
    if (result.deletedCount === 0) {
      throw new NotFoundException(`Recurring schedule "${id}" not found`);
    }
    this.logger.log(
      { householdId, recurringId: id },
      'Recurring schedule deleted',
    );
  }

  /**
   * Turn every due recurring schedule into ledger transactions (VEG-467).
   *
   * Runs once a day behind the CronLockService leader election. Per schedule,
   * per occurrence, the order is: **insert the transaction → apply the balance
   * → advance nextDate**. That ordering is deliberate. The ledger is the source
   * of truth and `Account.balanceCents` is a cache that can be re-derived from
   * it, so a crash mid-occurrence leaves the ledger complete and, at worst, the
   * cached balance short — loud and recoverable. Advancing first would instead
   * lose the occurrence outright, with nothing anywhere recording that it
   * should have existed. The { recurringId, date } unique index makes the retry
   * safe: re-attempting an already-written occurrence is a benign duplicate,
   * not a second row and a double-applied delta.
   *
   * The advance is a guarded `updateOne` (filtered on the nextDate we observed)
   * so two instances racing the same schedule cannot both advance it.
   */
  async materializeDue(
    now: Date = new Date(),
  ): Promise<MaterializationSummary> {
    const summary: MaterializationSummary = {
      scanned: 0,
      materialized: 0,
      duplicate: 0,
      skipped: 0,
      deactivated: 0,
      advancedOnly: 0,
      capped: 0,
      yielded: 0,
      failed: 0,
    };

    // Day granularity, matching how endDate is compared everywhere else: an
    // occurrence dated noon today is due at a midnight run. An `$lte: now`
    // bound would defer it by a whole day.
    const dueBefore = new Date(utcDay(now) + 24 * 60 * 60 * 1000);
    const cursor = this.recurringModel
      .find({
        isActive: true,
        nextDate: { $lt: dueBefore },
      } as Record<string, unknown>)
      .lean()
      .cursor();

    for await (const raw of cursor) {
      const schedule = raw as unknown as DueSchedule;
      summary.scanned += 1;
      try {
        await this.materializeSchedule(schedule, now, summary);
      } catch (error: unknown) {
        // One bad schedule must not strand the rest of the households — same
        // per-document isolation the notifications cron uses.
        summary.failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          {
            householdId: schedule.householdId.toString(),
            recurringId: schedule._id.toString(),
          },
          `Recurring materialization failed for schedule: ${message}`,
        );
      }
    }

    return summary;
  }

  // Catch one schedule up to today, materializing an occurrence per period.
  private async materializeSchedule(
    schedule: DueSchedule,
    now: Date,
    summary: MaterializationSummary,
  ): Promise<void> {
    const householdId = schedule.householdId.toString();
    const recurringId = schedule._id.toString();

    // Account-less subscriptions (VEG-469 fold-in) never post to the ledger —
    // they have no account — but their nextDate must still roll forward so the
    // Subscriptions page shows a real upcoming date, exactly as the retired
    // subscription cron did. This runs BEFORE reference resolution: an
    // account-less sub has nothing to resolve, and an archived category must
    // not freeze its billing date (nothing posts, so the "no new activity on
    // archived refs" rule doesn't apply).
    if (schedule.isSubscription && !schedule.accountId) {
      await this.advanceSubscriptionOnly(schedule, now, summary);
      return;
    }

    const references = await this.resolveMaterializationRefs(schedule);
    if (!references.usable) {
      // Skip WITHOUT advancing. Leaving nextDate stale keeps the schedule at
      // the top of the household's nextDate-sorted list as a visible signal,
      // and once the account/category is fixed this same loop replays every
      // missed period. Advancing would swallow those occurrences silently.
      // Deactivating would be worse still: update() refuses to reactivate a
      // schedule whose reference is archived, so the cron would create a state
      // the API will not let the user undo.
      summary.skipped += 1;
      // Enough context to act on without a database round trip: which bill,
      // and how long it has been stalled. A schedule 90 days behind reads very
      // differently from one skipped for the first time, and this warns once
      // per day for as long as it stays broken.
      this.logger.warn(
        {
          householdId,
          recurringId,
          reason: references.reason,
          payee: schedule.payee,
          nextDate: schedule.nextDate.toISOString(),
          daysStale: Math.floor(
            (utcDay(now) - utcDay(schedule.nextDate)) / 86_400_000,
          ),
        },
        'Skipping recurring schedule with an unusable reference',
      );
      return;
    }

    let occurrence = schedule.nextDate;
    let periods = 0;

    for (;;) {
      // Past its end: nothing more to post, ever.
      if (schedule.endDate && utcDay(occurrence) > utcDay(schedule.endDate)) {
        // Count it only if THIS run is the one that deactivated it — a
        // concurrent run winning the guard would otherwise be double-counted.
        const deactivated = await this.advanceSchedule(
          schedule,
          occurrence,
          occurrence,
          false,
        );
        if (deactivated) {
          summary.deactivated += 1;
        }
        return;
      }
      // Not due yet — the normal exit once the schedule has caught up.
      if (utcDay(occurrence) > utcDay(now)) {
        return;
      }
      // Cap check sits AFTER the two clean-exit guards, so a schedule that
      // finishes exactly on the cap leaves via "caught up" rather than being
      // reported capped — otherwise it would look permanently behind and be
      // re-scanned as such forever. Reaching here means real work remains.
      if (periods >= RecurringService.MAX_CATCHUP_PERIODS) {
        summary.capped += 1;
        this.logger.warn(
          {
            householdId,
            recurringId,
            cap: RecurringService.MAX_CATCHUP_PERIODS,
            nextDate: occurrence.toISOString(),
            daysBehind: Math.floor(
              (utcDay(now) - utcDay(occurrence)) / 86_400_000,
            ),
          },
          'Recurring schedule hit the per-run catch-up cap; resuming on the next run',
        );
        return;
      }

      const result = await this.transactionsService.materializeRecurring(
        householdId,
        {
          recurringId,
          accountId: references.accountId.toString(),
          categoryId: schedule.categoryId.toString(),
          memberId: schedule.memberId?.toString(),
          type: toTransactionType(schedule.type),
          amountCents: schedule.amountCents,
          date: occurrence,
          payee: schedule.payee,
          notes: schedule.notes,
          tags: schedule.tags ?? [],
        },
      );
      if (result.duplicate) {
        // A previous run wrote this one and died before advancing. Treat it as
        // done and move on — aborting here would wedge the schedule forever,
        // re-colliding on the same date every night.
        summary.duplicate += 1;
      } else {
        summary.materialized += 1;
      }

      const next = addCadence(
        occurrence,
        schedule.cadence,
        schedule.cadenceAnchorDay,
      );

      // Deactivate in the SAME write as the final advance when the schedule
      // has now run its course — no extra round trip, and it drops the row out
      // of the { isActive, nextDate } scan instead of being re-read forever.
      const finished =
        schedule.endDate !== undefined &&
        utcDay(next) > utcDay(schedule.endDate);
      const advanced = await this.advanceSchedule(
        schedule,
        occurrence,
        next,
        !finished,
      );
      if (!advanced) {
        // Someone else moved nextDate between our read and this write, so the
        // remaining periods are not ours to post. State what was OBSERVED
        // rather than guessing a cause: leader election makes a second cron
        // instance unlikely, and the realistic causes are a concurrent PATCH
        // or the cursor re-visiting this document — an unsnapshotted scan over
        // { isActive, nextDate } while the loop pushes nextDate forward within
        // that same index. The guard makes a re-visit harmless (the insert
        // dedupes, this advance misses, we stop) but it is not "concurrency".
        summary.yielded += 1;
        this.logger.warn(
          {
            householdId,
            recurringId,
            observedNextDate: occurrence.toISOString(),
            attemptedNextDate: next.toISOString(),
          },
          'Guarded advance matched no schedule (concurrent edit or cursor re-visit); yielding the remaining periods',
        );
        return;
      }
      if (finished) {
        summary.deactivated += 1;
        return;
      }

      occurrence = next;
      periods += 1;
    }
  }

  // Roll an account-less subscription's nextDate forward to the next future
  // occurrence WITHOUT materializing anything — the retired subscription cron's
  // sole job (VEG-469). Same catch-up shape as materializeSchedule (endDate
  // deactivation, per-run cap, guarded advance) minus the ledger write and the
  // reference resolution. Advancing period-by-period (rather than jumping) keeps
  // cadenceAnchorDay drift-correct and reuses the same guarded write, so a
  // cursor re-visit or concurrent PATCH can't double-advance.
  private async advanceSubscriptionOnly(
    schedule: DueSchedule,
    now: Date,
    summary: MaterializationSummary,
  ): Promise<void> {
    const householdId = schedule.householdId.toString();
    const recurringId = schedule._id.toString();

    let occurrence = schedule.nextDate;
    let periods = 0;

    for (;;) {
      // Past its end: deactivate in the guarded write, like the ledger path.
      if (schedule.endDate && utcDay(occurrence) > utcDay(schedule.endDate)) {
        const deactivated = await this.advanceSchedule(
          schedule,
          occurrence,
          occurrence,
          false,
        );
        if (deactivated) {
          summary.deactivated += 1;
        }
        return;
      }
      // Caught up to today — the normal exit.
      if (utcDay(occurrence) > utcDay(now)) {
        return;
      }
      if (periods >= RecurringService.MAX_CATCHUP_PERIODS) {
        summary.capped += 1;
        this.logger.warn(
          {
            householdId,
            recurringId,
            cap: RecurringService.MAX_CATCHUP_PERIODS,
            nextDate: occurrence.toISOString(),
          },
          'Subscription advance-only hit the per-run catch-up cap; resuming on the next run',
        );
        return;
      }

      const next = addCadence(
        occurrence,
        schedule.cadence,
        schedule.cadenceAnchorDay,
      );
      const finished =
        schedule.endDate !== undefined &&
        utcDay(next) > utcDay(schedule.endDate);
      const advanced = await this.advanceSchedule(
        schedule,
        occurrence,
        next,
        !finished,
      );
      if (!advanced) {
        summary.yielded += 1;
        this.logger.warn(
          {
            householdId,
            recurringId,
            observedNextDate: occurrence.toISOString(),
            attemptedNextDate: next.toISOString(),
          },
          'Guarded advance-only matched no schedule (concurrent edit or cursor re-visit); yielding',
        );
        return;
      }
      summary.advancedOnly += 1;
      if (finished) {
        summary.deactivated += 1;
        return;
      }

      occurrence = next;
      periods += 1;
    }
  }

  // Advance nextDate, guarded on the value we observed so concurrent runs
  // cannot both advance the same schedule. Returns false when the guard misses.
  private async advanceSchedule(
    schedule: DueSchedule,
    observed: Date,
    next: Date,
    stayActive: boolean,
  ): Promise<boolean> {
    const set: Record<string, unknown> = { nextDate: next };
    if (!stayActive) {
      set.isActive = false;
    }
    const result = await this.recurringModel
      .updateOne(
        { _id: schedule._id, nextDate: observed } as Record<string, unknown>,
        { $set: set },
      )
      .exec();
    return (result.matchedCount ?? 0) > 0;
  }

  // Whether a schedule can post to the ledger right now. The scheduler resolves
  // both references ONCE per schedule rather than per occurrence — a 60-period
  // catch-up would otherwise issue 120 redundant lookups for references that
  // cannot change mid-loop.
  //
  // The usable branch carries the resolved accountId so the caller cannot need
  // a non-null assertion: `new Types.ObjectId(undefined)` mints a random VALID
  // ObjectId, which would post money to a nonexistent account and leave
  // applyBalanceDelta logging drift instead of throwing. Making the type carry
  // the guarantee keeps that unreachable by construction rather than by a
  // check in another function.
  private async resolveMaterializationRefs(
    schedule: DueSchedule,
  ): Promise<MaterializationRefs> {
    if (!schedule.accountId) {
      // Legacy subscriptions migrate without an account (VEG-469) and wait
      // here until one is assigned.
      return { usable: false, reason: 'no accountId' };
    }
    const householdId = schedule.householdId.toString();

    try {
      const account = await this.accountsService.findOne(
        householdId,
        schedule.accountId.toString(),
      );
      if (account.isArchived) {
        return { usable: false, reason: 'account archived' };
      }
    } catch (error) {
      if (error instanceof NotFoundException) {
        return { usable: false, reason: 'account missing' };
      }
      throw error;
    }

    const category = await this.categoriesService.findInHousehold(
      householdId,
      schedule.categoryId.toString(),
    );
    if (!category) {
      return { usable: false, reason: 'category missing' };
    }
    if (category.isArchived) {
      // Mirrors the manual create path: no NEW activity against an archived
      // category. A scheduler write is new activity by that same rule.
      return { usable: false, reason: 'category archived' };
    }
    return { usable: true, accountId: schedule.accountId };
  }

  // --- helpers -------------------------------------------------------------

  // Cross-field invariants on the merged (would-be-persisted) state. The
  // date-pair check is skippable because an already-expired schedule is a
  // legitimate stored state; the subscription invariant never is.
  private validateScheduleState(
    state: ScheduleState,
    { checkDates = true }: { checkDates?: boolean } = {},
  ): void {
    // @IsDateString (isISO8601) admits formats JS Date cannot parse (week
    // dates like 2026-W32, ordinal 2026-213); reject them here so they fail
    // as 400s instead of Invalid Date blowing up inside Mongoose at save.
    if (Number.isNaN(state.nextDate.getTime())) {
      throw new BadRequestException('nextDate must be a parseable date');
    }
    if (state.endDate && Number.isNaN(state.endDate.getTime())) {
      throw new BadRequestException('endDate must be a parseable date');
    }
    if (state.isSubscription && state.type !== RecurringType.EXPENSE) {
      throw new BadRequestException('isSubscription requires type: expense');
    }
    // Day granularity, not instants: endDate is "the last DATE the schedule
    // may run", and @IsDateString admits full datetimes — a date-only endDate
    // on the same calendar day as a noon nextDate is a valid final occurrence.
    if (
      checkDates &&
      state.endDate &&
      utcDay(state.endDate) < utcDay(state.nextDate)
    ) {
      throw new BadRequestException('endDate must be on or after nextDate');
    }
  }

  // Assert the account exists in this household and can take new activity.
  // Cross-household/missing references are a client error (400), not a 404 —
  // the schedule is what's being created/updated. `reactivating` only reworks
  // the archived message: on PATCH { isActive: true } the client never sent
  // an accountId, so blaming that field would point at nothing actionable.
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
          ? 'Cannot reactivate a schedule whose account is archived'
          : 'Cannot point a recurring schedule at an archived account',
      );
    }
  }

  private async assertCategoryUsable(
    householdId: string,
    categoryId: string,
    { reactivating = false }: { reactivating?: boolean } = {},
  ): Promise<void> {
    const category = await this.categoriesService.findInHousehold(
      householdId,
      categoryId,
    );
    if (!category) {
      throw new BadRequestException(
        'categoryId does not reference a category in this household',
      );
    }
    if (category.isArchived) {
      throw new BadRequestException(
        reactivating
          ? 'Cannot reactivate a schedule whose category is archived'
          : 'Cannot point a recurring schedule at an archived category',
      );
    }
  }
}
