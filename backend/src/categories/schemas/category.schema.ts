import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type CategoryDocument = HydratedDocument<Category>;

// A budgeting category (e.g. "Groceries", "Paycheck"). Household-scoped and
// grouped under a CategoryGroup. `isIncome` separates income categories
// (paychecks) from expense categories — transactions and, later, budgets read
// it. Replaces the hardcoded CATEGORIES array in frontend/src/lib/types.ts.
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
