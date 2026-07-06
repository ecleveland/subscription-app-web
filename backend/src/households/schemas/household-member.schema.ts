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

// A user has at most one row per household. Invitation acceptance must mutate
// this row in place (INVITED -> ACTIVE), not insert a second one, or it trips
// this index (the acceptance flow lands in VEG-390).
HouseholdMemberSchema.index({ householdId: 1, userId: 1 }, { unique: true });

// Enforce the "one active household per user" invariant that
// findMembershipByUser relies on to resolve the caller's active household.
// Partial so that invited/inactive rows don't count toward the constraint.
// Explicitly named: the auto-generated name (userId_1) collides with the
// plain index from the @Prop({ index: true }) on userId — same name,
// different spec — and Mongo then rejects (or autoIndex silently skips)
// creating this one, leaving the invariant unenforced.
HouseholdMemberSchema.index(
  { userId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: MembershipStatus.ACTIVE },
    name: 'userId_active_unique',
  },
);
