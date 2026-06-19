import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type BudgetCategoryDocument = HydratedDocument<BudgetCategory>;

// The planned spending limit for one category within one month's Budget. This
// is the category-limits half of the hybrid model: `plannedCents` *is* the
// monthly limit. Zero-based / envelope budgeting layers on later additively —
// the derived "to be budgeted" is computed on read (VEG-439) and an optional
// `rolloverCents` carry-over field can be added here — with no migration, which
// is exactly why those fields are intentionally omitted now (see
// budgeting.md § Budget). Scoped to a household transitively via its parent
// Budget; queries go through budgetId.
@Schema({ timestamps: true })
export class BudgetCategory {
  // No standalone `index: true`: the unique compound index below has budgetId as
  // its prefix, so it already serves the per-budget reads.
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Budget',
    required: true,
  })
  budgetId: MongooseSchema.Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Category',
    required: true,
  })
  categoryId: MongooseSchema.Types.ObjectId;

  // The planned limit in integer minor units (cents) — never a float (see
  // budgeting.md § Money handling). Enforced at the schema layer (not just the
  // DTO) so no write path can persist a fractional or negative limit.
  @Prop({
    required: true,
    min: 0,
    validate: {
      validator: Number.isInteger,
      message: 'plannedCents must be an integer (minor units)',
    },
  })
  plannedCents: number;
}

export const BudgetCategorySchema =
  SchemaFactory.createForClass(BudgetCategory);

// At most one planned amount per (budget, category). Also serves the per-budget
// read (budgetId prefix) when the VEG-439 reader loads a month's limits.
BudgetCategorySchema.index({ budgetId: 1, categoryId: 1 }, { unique: true });
