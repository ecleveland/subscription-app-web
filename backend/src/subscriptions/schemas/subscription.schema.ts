import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type SubscriptionDocument = HydratedDocument<Subscription>;

export enum BillingCycle {
  MONTHLY = 'monthly',
  YEARLY = 'yearly',
}

@Schema({ timestamps: true })
export class Subscription {
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
}

export const SubscriptionSchema = SchemaFactory.createForClass(Subscription);
