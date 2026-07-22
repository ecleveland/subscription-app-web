import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type RecurringTransactionDocument =
  HydratedDocument<RecurringTransaction>;

// income | expense only — recurring transfers are out of scope for Phase 4, so
// this deliberately does not reuse TransactionType (which includes transfer).
export enum RecurringType {
  INCOME = 'income',
  EXPENSE = 'expense',
}

// Values intentionally identical to Subscription.BillingCycle so the VEG-469
// fold-in maps billingCycle → cadence 1:1.
export enum RecurringCadence {
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
  YEARLY = 'yearly',
}

// A recurring schedule (per budgeting.md § RecurringTransaction): the template
// the Phase 4 scheduler materializes into ledger Transactions when nextDate
// comes due. Bills are type: expense; scheduled income (paychecks) is type:
// income. A subscription is just a schedule with isSubscription: true — the
// Subscriptions page becomes a filtered view of this collection (VEG-469).
@Schema({ timestamps: true })
export class RecurringTransaction {
  // Ownership/visibility scope, resolved server-side by HouseholdGuard once
  // VEG-466 wires it — never trusted from the client. No standalone index: the compound
  // { householdId: 1, nextDate: 1 } below has householdId as its prefix.
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Household',
    required: true,
  })
  householdId: MongooseSchema.Types.ObjectId;

  // The account materialized Transactions post to. Optional: legacy
  // subscriptions migrate without one (VEG-469), and the scheduler skips
  // account-less schedules until an account is assigned. New schedules created
  // via the API require it at the DTO layer (VEG-466).
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Account' })
  accountId?: MongooseSchema.Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Category',
    required: true,
  })
  categoryId: MongooseSchema.Types.ObjectId;

  // Attribution: the HouseholdMember who created the schedule. Optional —
  // mirrors Transaction.memberId / Subscription.memberId.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'HouseholdMember' })
  memberId?: MongooseSchema.Types.ObjectId;

  @Prop({ required: true, enum: RecurringType })
  type: RecurringType;

  // Integer magnitude in minor units (cents); sign comes from `type`. Enforced
  // at the schema layer (not just DTOs) because the VEG-469 fold-in migration —
  // and any future non-DTO write path — bypasses the ValidationPipe; same
  // rationale as Transaction.amountCents.
  //
  // Bound is conditional: subscriptions may be free ($0 → 0 cents, a legal
  // legacy Subscription.cost), so a subscription doc allows 0; every other
  // schedule needs a positive magnitude (≥1). The `/api/recurring` DTOs keep
  // Min(1), so this relaxation only reaches the fold-in write path. On query
  // (update) validation `this` isn't a Document, so it falls back to the strict
  // ≥1 bound (the invariant is enforced on the save path the fold-in uses).
  @Prop({
    required: true,
    validate: {
      validator: function (this: unknown, v: number): boolean {
        if (!Number.isInteger(v)) return false;
        const isSub =
          this instanceof Document &&
          (this as unknown as RecurringTransaction).isSubscription === true;
        return isSub ? v >= 0 : v >= 1;
      },
      message:
        'amountCents must be an integer (minor units); 0 is allowed only for subscriptions',
    },
  })
  amountCents: number;

  // The schedule's display identity (Subscription.name maps here in VEG-469) —
  // required, unlike the optional payee on one-off Transactions.
  @Prop({ required: true, trim: true })
  payee: string;

  @Prop({ trim: true })
  notes?: string;

  @Prop({ type: [String], default: [] })
  tags: string[];

  @Prop({ required: true, enum: RecurringCadence })
  cadence: RecurringCadence;

  // The next occurrence: the date the scheduler materializes a Transaction for
  // and then advances by `cadence`.
  @Prop({ required: true })
  nextDate: Date;

  // The schedule's intended day-of-month, held separately from `nextDate` so a
  // month-length clamp stays temporary. Re-deriving the day from the stored
  // date each run (what SubscriptionsService.advanceToFutureDate does) makes a
  // clamp permanent: a bill on the 31st becomes Feb 28 and then stays on the
  // 28th forever. With the anchor kept, Jan 31 → Feb 28 → Mar 31 (VEG-467).
  //
  // Server-derived only — deliberately absent from both DTOs, so `whitelist:
  // true` strips any client attempt to set an anchor that disagrees with
  // nextDate. Optional: absent means "use nextDate's own day", which is exactly
  // right for every schedule anchored on day ≤ 28 and for legacy rows the
  // VEG-469 fold-in migrates, so no backfill is required.
  @Prop({
    required: false,
    min: 1,
    max: 31,
    validate: {
      validator: (v: number | null) => v == null || Number.isInteger(v),
      message: 'cadenceAnchorDay must be an integer day-of-month',
    },
  })
  cadenceAnchorDay?: number;

  // The integer validator also rejects explicit null (Mongoose applies the
  // default only to undefined and skips min/max on null), which the VEG-469
  // fold-in could otherwise persist and break the reminder cron's date math.
  @Prop({
    default: 3,
    min: 0,
    max: 30,
    validate: {
      validator: Number.isInteger,
      message: 'reminderDaysBefore must be an integer number of days',
    },
  })
  reminderDaysBefore: number;

  // Last date the schedule may materialize; absent means it runs indefinitely.
  @Prop({ required: false })
  endDate?: Date;

  // Pause/resume without deleting history (mirrors Subscription.isActive).
  // Also the equality prefix of the cron-scan index below.
  @Prop({ default: true })
  isActive: boolean;

  // Marks schedules that surface on the Subscriptions page — a filtered view
  // of this collection, not a separate silo (VEG-469). A subscription is by
  // definition a recurring *expense*; the validator makes income subscriptions
  // unrepresentable on the save path. Updates MUST go through load-and-save
  // (VEG-466): under update validators `this` is the Query (this.type is
  // undefined), and they only run for paths in the update anyway, so
  // runValidators cannot enforce a cross-field invariant — the validator
  // passes on non-document paths rather than rejecting every valid update.
  @Prop({
    default: false,
    validate: {
      validator: function (this: unknown, v: boolean) {
        if (!(this instanceof Document)) return true;
        return (
          !v ||
          (this as unknown as RecurringTransaction).type ===
            RecurringType.EXPENSE
        );
      },
      message: 'isSubscription requires type: expense',
    },
  })
  isSubscription: boolean;

  // Number of people splitting the cost (mirrors Subscription.sharedWith).
  // Explicit null must pass: the legacy Subscription contract accepts and
  // persists sharedWith: null to clear sharing (DTO ValidateIf skips null;
  // the service queries { $in: [null, undefined] }), so migrated docs and
  // null-to-clear PATCHes stay valid. `min` already skips null.
  @Prop({
    required: false,
    min: 2,
    validate: {
      validator: (v: number | null) => v == null || Number.isInteger(v),
      message: 'sharedWith must be an integer number of people',
    },
  })
  sharedWith?: number;

  // Subscription-only: the free-trial end date carried over from
  // Subscription.trialEndDate (VEG-469). The recurring model has no other use
  // for it, so it is optional and unindexed (the trial UI derives from the
  // fetched list; no cron scans by it).
  @Prop({ required: false })
  trialEndDate?: Date;

  // Subscription-only: the verbatim legacy Subscription.category string
  // (VEG-469). Kept alongside the budgeting `categoryId` so the /api/subscriptions
  // compatibility layer round-trips the original free-text category exactly,
  // independent of the best-effort budget-category link. Absent for non-subs.
  @Prop({ required: false, trim: true })
  subscriptionCategory?: string;
}

export const RecurringTransactionSchema =
  SchemaFactory.createForClass(RecurringTransaction);

// Household-scoped lists sorted by next occurrence (upcoming-bills view).
RecurringTransactionSchema.index({ householdId: 1, nextDate: 1 });
// Daily scheduler/reminder crons: scan active schedules by due date across all
// households (mirrors { isActive, nextBillingDate } on Subscription).
RecurringTransactionSchema.index({ isActive: 1, nextDate: 1 });
