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
  // Ownership/visibility scope: the household this account belongs to. Resolved
  // server-side by HouseholdGuard — never trusted from the client. Mirrors the
  // household scoping already applied to subscriptions/notifications.
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
  // budgeting.md § Money handling). Derived from transactions and recomputed on
  // transaction write (VEG-399); seeded here from the opening balance. Credit
  // and loan accounts carry negative balances.
  @Prop({ required: true, default: 0 })
  balanceCents: number;

  @Prop({ required: true, default: false })
  isArchived: boolean;
}

export const AccountSchema = SchemaFactory.createForClass(Account);
