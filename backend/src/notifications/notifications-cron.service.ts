import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  RecurringTransaction,
  RecurringTransactionDocument,
} from '../recurring/schemas/recurring-transaction.schema';
import { NotificationsService } from './notifications.service';
import { CronLockService } from '../common/cron-lock/cron-lock.service';

@Injectable()
export class NotificationsCronService {
  private readonly logger = new Logger(NotificationsCronService.name);
  static readonly LOCK_KEY = 'renewal-reminders';

  // Reads the subscription slice of RecurringTransaction (VEG-469). Because the
  // fold-in preserved each subscription's _id, the Notification dedup key
  // { householdId, subscriptionId, billingDate } stays byte-stable across the
  // cutover — no double reminders, no schema change. Reminders for
  // non-subscription bills are VEG-468 (a wider filter + copy), out of scope here.
  constructor(
    @InjectModel(RecurringTransaction.name)
    private recurringModel: Model<RecurringTransactionDocument>,
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
    const cursor = this.recurringModel
      .find({
        isActive: true,
        isSubscription: true,
        reminderDaysBefore: { $gt: 0 },
        nextDate: { $gte: now, $lte: maxWindow },
      } as Record<string, unknown>)
      .lean()
      .cursor();

    let checked = 0;
    let created = 0;
    let failed = 0;
    let skipped = 0;
    for await (const sub of cursor) {
      checked++;
      const billingDate = new Date(sub.nextDate);
      const reminderDate = new Date(billingDate);
      reminderDate.setDate(reminderDate.getDate() - sub.reminderDaysBefore);

      if (reminderDate <= now) {
        const docId = (
          sub._id as unknown as { toHexString(): string }
        ).toHexString();
        // A subscription should always carry a householdId, but a legacy doc
        // left un-stamped by the migration (e.g. an owner with no active
        // membership) could slip through this unscoped query. Skip it rather
        // than dereferencing undefined, which would abort the whole run.
        if (!sub.householdId) {
          skipped++;
          this.logger.warn(
            { subscriptionId: docId },
            'Skipping renewal reminder: subscription has no householdId',
          );
          continue;
        }
        const householdId = (
          sub.householdId as unknown as { toHexString(): string }
        ).toHexString();
        // Isolate per-subscription failures so one bad write doesn't drop
        // reminders for everyone after it (the daily lock prevents a retry).
        try {
          await this.notificationsService.createRenewalReminder(
            householdId,
            docId,
            sub.payee,
            billingDate,
            sub.reminderDaysBefore,
          );
          created++;
        } catch (error: unknown) {
          failed++;
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            { subscriptionId: docId, householdId },
            `Failed to create renewal reminder: ${message}`,
          );
        }
      }
    }

    this.logger.log(
      { checked, created, failed, skipped },
      'Renewal reminder cron job complete',
    );
  }
}
