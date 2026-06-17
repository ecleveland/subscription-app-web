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
  // Ownership/visibility scope: the household this subscription belongs to.
  // Resolved server-side by HouseholdGuard — never trusted from the client.
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Household',
    required: true,
    index: true,
  })
  householdId: MongooseSchema.Types.ObjectId;

  // Attribution: the HouseholdMember who created the subscription ("who did
  // it"). Visibility is the household's, but we keep the acting member.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'HouseholdMember' })
  memberId: MongooseSchema.Types.ObjectId;

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

  @Prop({ required: false })
  trialEndDate?: Date;

  @Prop({ required: false, min: 2 })
  sharedWith?: number;
}

export const SubscriptionSchema = SchemaFactory.createForClass(Subscription);
