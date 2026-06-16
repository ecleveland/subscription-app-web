import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import { HouseholdRole } from './household-member.schema';

export type InvitationDocument = HydratedDocument<Invitation>;

export enum InvitationStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  REVOKED = 'revoked',
  EXPIRED = 'expired',
}

@Schema({ timestamps: true })
export class Invitation {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Household',
    required: true,
    index: true,
  })
  householdId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true, trim: true, lowercase: true })
  email: string;

  // HMAC/hash of the invite token; the raw token is only ever sent by email.
  @Prop({ required: true })
  tokenHash: string;

  // Explicit `type: String` is required because HouseholdRole is imported from
  // another file; without it Nest cannot infer the Mongoose type from the
  // reflected metadata (same-file enums infer fine).
  @Prop({
    type: String,
    required: true,
    enum: HouseholdRole,
    default: HouseholdRole.ADULT,
  })
  role: HouseholdRole;

  @Prop({
    required: true,
    enum: InvitationStatus,
    default: InvitationStatus.PENDING,
  })
  status: InvitationStatus;

  @Prop({ required: true })
  expiresAt: Date;
}

export const InvitationSchema = SchemaFactory.createForClass(Invitation);
