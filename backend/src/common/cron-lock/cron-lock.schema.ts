import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CronLockDocument = HydratedDocument<CronLock>;

/**
 * A short-lived distributed lock used for cron leader election across replicas.
 * A unique `{ key, runDate }` index means exactly one instance can insert the
 * lock for a given job+day; the loser of the race sees an E11000 and skips.
 * A TTL on `expiresAt` lets MongoDB reap stale locks automatically.
 */
@Schema({ timestamps: true })
export class CronLock {
  @Prop({ required: true })
  key: string;

  @Prop({ required: true })
  runDate: string;

  @Prop({ required: true, expires: 0 })
  expiresAt: Date;
}

export const CronLockSchema = SchemaFactory.createForClass(CronLock);

CronLockSchema.index({ key: 1, runDate: 1 }, { unique: true });
