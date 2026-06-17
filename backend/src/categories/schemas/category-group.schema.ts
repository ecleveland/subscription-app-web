import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type CategoryGroupDocument = HydratedDocument<CategoryGroup>;

// A named grouping of categories (e.g. "Housing", "Food") for display ordering.
// Household-scoped like every other budgeting entity. Full management (rename,
// reorder, add/remove) lands with the Phase 3 budgeting epic; Phase 2 only
// seeds a sensible default set and reads them.
@Schema({ timestamps: true })
export class CategoryGroup {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Household',
    required: true,
    index: true,
  })
  householdId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, default: 0 })
  sortOrder: number;
}

export const CategoryGroupSchema = SchemaFactory.createForClass(CategoryGroup);
