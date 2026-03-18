import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type SubscriptionDocument = HydratedDocument<Subscription>;

export enum BillingCycle {
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
  YEARLY = 'yearly',
}

@Schema({ timestamps: true })
export class Subscription {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', index: true })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, min: 0 })
  cost: number;

  @Prop({ required: true, enum: BillingCycle })
  billingCycle: BillingCycle;

  @Prop({ required: true })
  nextBillingDate: Date;

  @Prop({ required: true, trim: true })
  category: string;

  @Prop({ trim: true })
  notes?: string;

  @Prop({ type: [String], default: [] })
  tags: string[];

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ default: 3, min: 0, max: 30 })
  reminderDaysBefore: number;
}

export const SubscriptionSchema = SchemaFactory.createForClass(Subscription);
