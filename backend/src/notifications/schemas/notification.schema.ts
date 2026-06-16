import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type NotificationDocument = HydratedDocument<Notification>;

export enum NotificationType {
  RENEWAL_REMINDER = 'renewal_reminder',
}

@Schema({ timestamps: true })
export class Notification {
  // Household-scoped: renewal reminders are visible to the whole household, not
  // a single user. Resolved server-side by HouseholdGuard.
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Household',
    required: true,
    index: true,
  })
  householdId: MongooseSchema.Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Subscription' })
  subscriptionId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true, enum: NotificationType })
  type: NotificationType;

  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ required: true, trim: true })
  message: string;

  @Prop({ default: false, index: true })
  read: boolean;

  @Prop({ required: true })
  billingDate: Date;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);

// Idempotency key for the renewal-reminder cron: one reminder per subscription
// per billing date, scoped to the owning household.
NotificationSchema.index(
  { householdId: 1, subscriptionId: 1, billingDate: 1 },
  { unique: true },
);
