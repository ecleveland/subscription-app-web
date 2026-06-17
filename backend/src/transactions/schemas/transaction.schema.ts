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

  // Links a transaction materialized by a recurring schedule. Reserved for
  // Phase 4; always null for now.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'RecurringTransaction' })
  recurringId?: MongooseSchema.Types.ObjectId;
}

export const TransactionSchema = SchemaFactory.createForClass(Transaction);

// Supports the common "ledger for an account, newest first" read and the
// household-scoped date-range filters.
TransactionSchema.index({ householdId: 1, date: -1 });
TransactionSchema.index({ accountId: 1, date: -1 });
