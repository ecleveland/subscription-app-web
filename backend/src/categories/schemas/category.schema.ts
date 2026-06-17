import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type CategoryDocument = HydratedDocument<Category>;

// A budgeting category (e.g. "Groceries", "Paycheck"). Household-scoped and
// grouped under a CategoryGroup. `isIncome` separates income categories
// (paychecks) from expense categories — transactions and, later, budgets read
// it. This is the server-owned source of truth for budgeting categories; future
// work can drive category pickers from it rather than a hardcoded frontend list.
@Schema({ timestamps: true })
export class Category {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Household',
    required: true,
    index: true,
  })
  householdId: MongooseSchema.Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'CategoryGroup',
    required: true,
    index: true,
  })
  groupId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, default: false })
  isIncome: boolean;

  @Prop({ required: true, default: 0 })
  sortOrder: number;

  @Prop({ required: true, default: false })
  isArchived: boolean;
}

export const CategorySchema = SchemaFactory.createForClass(Category);

// A household has at most one category per (group, name). Lets the idempotent
// seed upsert by (householdId, groupId, name) so concurrent seeds converge
// instead of duplicating; the prefix also serves the household-scoped reads.
CategorySchema.index({ householdId: 1, groupId: 1, name: 1 }, { unique: true });
