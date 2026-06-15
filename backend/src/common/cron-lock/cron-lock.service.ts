import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CronLock, CronLockDocument } from './cron-lock.schema';

@Injectable()
export class CronLockService {
  private readonly logger = new Logger(CronLockService.name);

  /** How long a lock lives before MongoDB's TTL monitor may reap it. */
  static readonly DEFAULT_TTL_MS = 48 * 60 * 60 * 1000; // 48h

  constructor(
    @InjectModel(CronLock.name)
    private readonly cronLockModel: Model<CronLockDocument>,
  ) {}

  /** UTC `YYYY-MM-DD` key identifying a single daily run. */
  static runDateKey(now: Date = new Date()): string {
    return now.toISOString().split('T')[0];
  }

  /**
   * Atomically claim the lock for `(key, runDate)`. Returns `true` if this
   * instance won the race and should run the job, `false` if another instance
   * already holds it (so this instance should skip).
   */
  async tryAcquire(
    key: string,
    runDate: string,
    ttlMs: number = CronLockService.DEFAULT_TTL_MS,
    now: Date = new Date(),
  ): Promise<boolean> {
    try {
      const lock = new this.cronLockModel({
        key,
        runDate,
        expiresAt: new Date(now.getTime() + ttlMs),
      });
      await lock.save();
      return true;
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as { code: number }).code === 11000
      ) {
        this.logger.debug(
          `Lock ${key}/${runDate} already held by another instance`,
        );
        return false;
      }
      throw error;
    }
  }
}
