import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type NotificationDocument = HydratedDocument<Notification>;

export enum NotificationType {
  RENEWAL_REMINDER = 'renewal_reminder',
  BILL_REMINDER = 'bill_reminder',
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

  // The RecurringTransaction _id the reminder is for: a subscription's id (kept
  // stable by the VEG-469 fold-in) or any bill/income schedule's id (VEG-468).
  // The name predates the fold-in; renaming it would break the unique index.
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

// Idempotency key for the reminder cron. One reminder per schedule per
// billing date, scoped to the owning household.
NotificationSchema.index(
  { householdId: 1, subscriptionId: 1, billingDate: 1 },
  { unique: true },
);
