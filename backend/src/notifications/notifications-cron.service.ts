import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Subscription,
  SubscriptionDocument,
} from '../subscriptions/schemas/subscription.schema';
import { NotificationsService } from './notifications.service';
import { CronLockService } from '../common/cron-lock/cron-lock.service';

@Injectable()
export class NotificationsCronService {
  private readonly logger = new Logger(NotificationsCronService.name);
  static readonly LOCK_KEY = 'renewal-reminders';

  constructor(
    @InjectModel(Subscription.name)
    private subscriptionModel: Model<SubscriptionDocument>,
    private notificationsService: NotificationsService,
    private cronLock: CronLockService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async handleRenewalReminders(): Promise<void> {
    const now = new Date();
    const runDate = CronLockService.runDateKey(now);

    // Leader election: only the instance that wins the daily lock runs the job.
    const acquired = await this.cronLock.tryAcquire(
      NotificationsCronService.LOCK_KEY,
      runDate,
    );
    if (!acquired) {
      this.logger.log(
        'Renewal reminder cron already handled by another instance; skipping',
      );
      return;
    }

    this.logger.log('Running renewal reminder cron job');

    const maxWindow = new Date(now);
    maxWindow.setDate(maxWindow.getDate() + 30);

    // Stream matching subscriptions rather than loading them all into memory.
    const cursor = this.subscriptionModel
      .find({
        isActive: true,
        reminderDaysBefore: { $gt: 0 },
        nextBillingDate: { $gte: now, $lte: maxWindow },
      } as Record<string, unknown>)
      .lean()
      .cursor();

    let checked = 0;
    let created = 0;
    let failed = 0;
    for await (const sub of cursor) {
      checked++;
      const billingDate = new Date(sub.nextBillingDate);
      const reminderDate = new Date(billingDate);
      reminderDate.setDate(reminderDate.getDate() - sub.reminderDaysBefore);

      if (reminderDate <= now) {
        const docId = (
          sub._id as unknown as { toHexString(): string }
        ).toHexString();
        const ownerId = (
          sub.userId as unknown as { toHexString(): string }
        ).toHexString();
        // Isolate per-subscription failures so one bad write doesn't drop
        // reminders for everyone after it (the daily lock prevents a retry).
        try {
          await this.notificationsService.createRenewalReminder(
            ownerId,
            docId,
            sub.name,
            billingDate,
            sub.reminderDaysBefore,
          );
          created++;
        } catch (error: unknown) {
          failed++;
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            { subscriptionId: docId, userId: ownerId },
            `Failed to create renewal reminder: ${message}`,
          );
        }
      }
    }

    this.logger.log(
      { checked, created, failed },
      'Renewal reminder cron job complete',
    );
  }
}
