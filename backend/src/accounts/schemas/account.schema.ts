import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type AccountDocument = HydratedDocument<Account>;

export enum AccountType {
  CHECKING = 'checking',
  SAVINGS = 'savings',
  CREDIT = 'credit',
  CASH = 'cash',
  INVESTMENT = 'investment',
  LOAN = 'loan',
}

@Schema({ timestamps: true })
export class Account {
  // Ownership/visibility scope: the household this account belongs to. Mirrors
  // the household scoping already applied to subscriptions/notifications; once
  // the HTTP API lands (VEG-398) it will be resolved server-side by
  // HouseholdGuard, never trusted from the client.
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Household',
    required: true,
    index: true,
  })
  householdId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, enum: AccountType })
  type: AccountType;

  // Cached balance in integer minor units (cents) — never a float (see
  // budgeting.md § Money handling). Seeded here from the opening balance and
  // kept in sync incrementally on every transaction write via
  // TransactionsService → applyBalanceDelta ($inc), rather than re-summed
  // (VEG-399). Credit and loan accounts carry negative balances. The integer
  // invariant is enforced
  // at the schema layer (not just the create DTO) so the VEG-399 recompute path,
  // which bypasses the DTO, cannot persist a float.
  @Prop({
    required: true,
    default: 0,
    validate: {
      validator: Number.isInteger,
      message: 'balanceCents must be an integer (minor units)',
    },
  })
  balanceCents: number;

  @Prop({ required: true, default: false })
  isArchived: boolean;
}

export const AccountSchema = SchemaFactory.createForClass(Account);
