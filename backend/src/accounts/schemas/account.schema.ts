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

  // The immutable opening-balance anchor, in integer minor units (cents). Seeded
  // at create from the same opening balance as `balanceCents`, then never
  // changed by the ledger. It exists so `balanceCents` is fully re-derivable:
  // the reconciliation invariant is `balanceCents === openingBalanceCents +
  // Σ(ledger deltas)` (VEG-478). Without it, a reconcile that summed only the
  // ledger would wipe every account's opening balance and flag clean accounts as
  // drifted. `default: 0` is a schema-layer guarantee for new documents; legacy
  // accounts created before this field are stamped once at boot by
  // ReconciliationService.backfillOpeningBalances (via a `$exists: false` query,
  // which the hydration default does not mask). Integer-validated at the schema
  // layer — like `balanceCents` — so the reconcile write path, which bypasses
  // the DTO, cannot persist a float.
  @Prop({
    required: true,
    default: 0,
    validate: {
      validator: Number.isInteger,
      message: 'openingBalanceCents must be an integer (minor units)',
    },
  })
  openingBalanceCents: number;

  @Prop({ required: true, default: false })
  isArchived: boolean;
}

export const AccountSchema = SchemaFactory.createForClass(Account);
