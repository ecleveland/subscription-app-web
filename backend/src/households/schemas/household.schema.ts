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
}

export const HouseholdSchema = SchemaFactory.createForClass(Household);
