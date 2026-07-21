import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type TransactionDocument = HydratedDocument<Transaction>;

export enum TransactionType {
  INCOME = 'income',
  EXPENSE = 'expense',
  TRANSFER = 'transfer',
}

// The atomic ledger unit (per budgeting.md). One-off entries today; also the
// materialized output of recurring schedules later (Phase 4). All money is
// integer cents — `amountCents` is always a positive magnitude; the sign of its
// effect on an account balance is derived from `type` (income +, expense −,
// transfer − from `accountId` / + to `transferAccountId`).
@Schema({ timestamps: true })
export class Transaction {
  // Ownership/visibility scope, resolved server-side by HouseholdGuard — never
  // trusted from the client. Mirrors the rest of the household-scoped data.
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Household',
    required: true,
    index: true,
  })
  householdId: MongooseSchema.Types.ObjectId;

  // The account this transaction posts to (the source account for a transfer).
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Account',
    required: true,
    index: true,
  })
  accountId: MongooseSchema.Types.ObjectId;

  // Income/expense reference a Category; transfers carry no category (net-zero
  // to the budget), so this is optional.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Category' })
  categoryId?: MongooseSchema.Types.ObjectId;

  // Attribution: the HouseholdMember who recorded the transaction. Optional —
  // not every write path supplies it (mirrors Subscription.memberId).
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'HouseholdMember' })
  memberId?: MongooseSchema.Types.ObjectId;

  @Prop({ required: true, enum: TransactionType })
  type: TransactionType;

  // Positive integer magnitude in minor units (cents); sign comes from `type`.
  // Enforced at the schema layer (not just the create DTO) so the Phase 4
  // recurring-materialization path, which bypasses the DTO, can't persist a
  // float or non-positive amount that would corrupt balance arithmetic.
  @Prop({
    required: true,
    min: 1,
    validate: {
      validator: Number.isInteger,
      message: 'amountCents must be a positive integer (minor units)',
    },
  })
  amountCents: number;

  @Prop({ required: true })
  date: Date;

  @Prop({ trim: true })
  payee?: string;

  @Prop({ trim: true })
  notes?: string;

  @Prop({ type: [String], default: [] })
  tags: string[];

  // Whether the transaction has cleared the account (reconciliation flag).
  @Prop({ default: false })
  cleared: boolean;

  // The destination account for a transfer; absent for income/expense.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Account' })
  transferAccountId?: MongooseSchema.Types.ObjectId;

  // Links a transaction materialized by a recurring schedule (VEG-467); unset
  // on manually-entered transactions. Also the dedupe key backing the
  // scheduler's exactly-once guarantee — see the unique index below.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'RecurringTransaction' })
  recurringId?: MongooseSchema.Types.ObjectId;
}

export const TransactionSchema = SchemaFactory.createForClass(Transaction);

// Supports the common "ledger for an account, newest first" read and the
// household-scoped date-range filters.
TransactionSchema.index({ householdId: 1, date: -1 });
TransactionSchema.index({ accountId: 1, date: -1 });

// The recurring scheduler's idempotency backstop (VEG-467): one materialized
// transaction per (schedule, occurrence day). The scheduler inserts BEFORE
// advancing nextDate, so a crash-and-retry re-attempts the same occurrence —
// this index turns that retry into a benign duplicate-key skip instead of a
// second ledger row and a double-applied balance delta.
//
// Two details are load-bearing:
//   * `$type: 'objectId'`, NOT `$exists: true`. `$exists` also matches a
//     document with an explicit `recurringId: null`, so every manual
//     transaction written that way would collide with every other on
//     (null, date) and start throwing E11000 at users. Manual writes leave the
//     field undefined today, but that's a property of the current write paths,
//     not one worth betting the create endpoint on.
//   * The scheduler normalizes `date` to UTC midnight before inserting.
//     Without that, two occurrences on the same calendar day but a different
//     time-of-day (nextDate carries one; @IsDateString admits full datetimes)
//     produce different keys and BOTH insert — silently defeating this index.
//
// Explicit name: VEG-450's bug was an auto-generated name colliding with an
// existing index and the build failing silently. buildAllIndexes() runs fatally
// at boot and in the E2E test app, so a conflict aborts rather than leaving the
// constraint unenforced.
TransactionSchema.index(
  { recurringId: 1, date: 1 },
  {
    unique: true,
    name: 'recurring_occurrence_unique',
    partialFilterExpression: { recurringId: { $type: 'objectId' } },
  },
);
