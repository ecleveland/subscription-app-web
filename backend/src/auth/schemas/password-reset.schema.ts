import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type PasswordResetDocument = HydratedDocument<PasswordReset>;

@Schema({ timestamps: true })
export class PasswordReset {
  // Indexed: requestPasswordReset invalidates prior unused tokens by email
  // (updateMany over { email, usedAt }) on every reset request.
  @Prop({ required: true, index: true })
  email: string;

  @Prop({ required: true, index: true })
  tokenHash: string;

  @Prop({ required: true, index: true, expires: 0 })
  expiresAt: Date;

  @Prop()
  usedAt?: Date;
}

export const PasswordResetSchema = SchemaFactory.createForClass(PasswordReset);
