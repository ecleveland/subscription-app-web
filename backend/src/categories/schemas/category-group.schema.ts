import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type CategoryGroupDocument = HydratedDocument<CategoryGroup>;

// A named grouping of categories (e.g. "Housing", "Food") for display ordering.
// Household-scoped like every other budgeting entity. A default set is seeded
// at household creation; households manage their own groups via the categories
// API (create/rename/reorder/delete-when-empty).
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

// A household has at most one group per name. Lets the idempotent seed upsert by
// (householdId, name) so concurrent boots/replicas converge instead of silently
// creating duplicate groups (the loser hits this index and is ignored).
CategoryGroupSchema.index({ householdId: 1, name: 1 }, { unique: true });
