import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type HouseholdMemberDocument = HydratedDocument<HouseholdMember>;

export enum HouseholdRole {
  OWNER = 'owner',
  ADULT = 'adult',
  TEEN = 'teen',
  VIEWER = 'viewer',
}

export enum MembershipStatus {
  ACTIVE = 'active',
  INVITED = 'invited',
}

@Schema({ timestamps: true })
export class HouseholdMember {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Household',
    required: true,
    index: true,
  })
  householdId: MongooseSchema.Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true, enum: HouseholdRole, default: HouseholdRole.ADULT })
  role: HouseholdRole;

  @Prop({
    required: true,
    enum: MembershipStatus,
    default: MembershipStatus.ACTIVE,
  })
  status: MembershipStatus;

  @Prop({ required: false })
  joinedAt?: Date;
}

export const HouseholdMemberSchema =
  SchemaFactory.createForClass(HouseholdMember);

// A user can belong to a given household at most once.
HouseholdMemberSchema.index({ householdId: 1, userId: 1 }, { unique: true });
