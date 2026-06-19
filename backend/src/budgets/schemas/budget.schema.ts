import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type BudgetDocument = HydratedDocument<Budget>;

// A household's budget for a single calendar month. It is just the container:
// the per-category planned limits hang off it as BudgetCategory rows, and the
// "actual" spend is never stored — it is computed from transactions on read
// (VEG-439). One Budget per household per month, enforced by the unique index
// below. Household-scoped like every other budgeting entity; the active
// household is resolved server-side by HouseholdGuard, never trusted from the
// client.
@Schema({ timestamps: true })
export class Budget {
  // No standalone `index: true` here: the unique compound index below has
  // householdId as its prefix, so it already serves household-scoped reads — a
  // separate single-field index would be redundant write overhead.
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Household',
    required: true,
  })
  householdId: MongooseSchema.Types.ObjectId;

  // The budget's month as "YYYY-MM" (e.g. "2026-06"). A string rather than a
  // Date so a month is an exact, timezone-free key; the budget-vs-actual reader
  // (VEG-439) derives the month's transaction date range from it.
  @Prop({
    required: true,
    trim: true,
    match: /^\d{4}-(0[1-9]|1[0-2])$/,
  })
  month: string;
}

export const BudgetSchema = SchemaFactory.createForClass(Budget);

// One budget per household per month. Also serves the household-scoped lookup
// (householdId prefix) the VEG-439 reader performs to load/auto-create a month.
BudgetSchema.index({ householdId: 1, month: 1 }, { unique: true });
