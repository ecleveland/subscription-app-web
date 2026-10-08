import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type GoalDocument = HydratedDocument<Goal>;

// Both goal types count up, so progress always reads currentCents / targetCents.
// A savings goal's target is the amount to save. A debt goal's target is the
// starting balance owed, and currentCents is how much of it has been paid off.
export enum GoalType {
  SAVINGS = 'savings',
  DEBT = 'debt',
}

const integerCents = (field: string) => ({
  validator: Number.isInteger,
  message: `${field} must be an integer (minor units)`,
});

@Schema({ timestamps: true })
export class Goal {
  // Resolved server-side by HouseholdGuard, never trusted from the client.
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Household',
    required: true,
  })
  householdId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, enum: GoalType })
  type: GoalType;

  @Prop({ required: true, min: 1, validate: integerCents('targetCents') })
  targetCents: number;

  // Changed only through the contributions endpoint, as an atomic $inc. Never
  // set from a create or update body. Can go negative after an over-correction;
  // that is left visible rather than clamped.
  @Prop({ required: true, default: 0, validate: integerCents('currentCents') })
  currentCents: number;

  @Prop({ type: Date })
  targetDate?: Date;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Category' })
  categoryId?: MongooseSchema.Types.ObjectId;

  // Lets a reached goal leave the default list without deleting its history.
  @Prop({ required: true, default: false })
  isArchived: boolean;
}

export const GoalSchema = SchemaFactory.createForClass(Goal);

// Serves the household list, which sorts newest first.
GoalSchema.index({ householdId: 1, createdAt: -1 });
