import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type HouseholdDocument = HydratedDocument<Household>;

@Schema({ timestamps: true })
export class Household {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  ownerId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true, default: 'USD', trim: true, uppercase: true })
  currency: string;

  // Set once the default category/group set has fully seeded. The startup
  // backfill only enumerates households missing this stamp, so user edits to
  // defaults (rename, hard-delete) are never resurrected by the upsert-by-name
  // seeder. A crash mid-seed leaves it unset → the household is repaired on the
  // next backfill.
  @Prop()
  defaultCategoriesSeededAt?: Date;
}

export const HouseholdSchema = SchemaFactory.createForClass(Household);
