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
import { utcDay } from '../common/utc-date.util';
import {
  daysUntil,
  isInReminderWindow,
} from '../recurring/recurring-dates.util';

const DAY_MS = 24 * 60 * 60 * 1000;
// Upper bound on reminderDaysBefore we bother scanning for.
const MAX_WINDOW_DAYS = 30;

@Injectable()
export class NotificationsCronService {
  private readonly logger = new Logger(NotificationsCronService.name);
  // Kept from when this cron only sent subscription renewals, so a deploy
  // mid-day still sees the lock the previous build took.
  static readonly LOCK_KEY = 'renewal-reminders';

  // The daily reminder pass for every active RecurringTransaction with a
  // reminder set: subscriptions and bills/income alike (VEG-468). Subscriptions
  // keep their renewal copy; everything else gets a "due soon" bill reminder.
  // Because the VEG-469 fold-in preserved each subscription's _id, the
  // Notification dedup key { householdId, subscriptionId, billingDate } stays
  // byte-stable across the cutover, so no double reminders and no schema change.
  constructor(
    @InjectModel(RecurringTransaction.name)
    private recurringModel: Model<RecurringTransactionDocument>,
    private notificationsService: NotificationsService,
    private cronLock: CronLockService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async handleReminders(): Promise<void> {
    const now = new Date();
    const runDate = CronLockService.runDateKey(now);

    // Leader election: only the instance that wins the daily lock runs the job.
    const acquired = await this.cronLock.tryAcquire(
      NotificationsCronService.LOCK_KEY,
      runDate,
    );
    if (!acquired) {
      this.logger.log(
        'Reminder cron already handled by another instance; skipping',
      );
      return;
    }

    this.logger.log('Running reminder cron job');

    // Day granularity. Anything due today was already posted by the midnight
    // materializer, so the scan starts at tomorrow's UTC midnight.
    const startOfTomorrowUtc = new Date(utcDay(now) + DAY_MS);
    const maxWindow = new Date(
      startOfTomorrowUtc.getTime() + MAX_WINDOW_DAYS * DAY_MS,
    );

    // Stream matching schedules rather than loading them all into memory.
    const cursor = this.recurringModel
      .find({
        isActive: true,
        reminderDaysBefore: { $gt: 0 },
        nextDate: { $gte: startOfTomorrowUtc, $lte: maxWindow },
      } as Record<string, unknown>)
      .lean()
      .cursor();

    let checked = 0;
    let created = 0;
    let failed = 0;
    let skipped = 0;
    for await (const row of cursor) {
      checked++;
      const billingDate = new Date(row.nextDate);
      if (!isInReminderWindow(billingDate, row.reminderDaysBefore, now)) {
        continue;
      }

      const docId = (
        row._id as unknown as { toHexString(): string }
      ).toHexString();
      // A schedule should always carry a householdId, but a legacy doc left
      // un-stamped by the migration (e.g. an owner with no active membership)
      // could slip through this unscoped query. Skip it rather than
      // dereferencing undefined, which would abort the whole run.
      if (!row.householdId) {
        skipped++;
        this.logger.warn(
          { recurringId: docId },
          'Skipping reminder: schedule has no householdId',
        );
        continue;
      }
      const householdId = (
        row.householdId as unknown as { toHexString(): string }
      ).toHexString();
      const daysUntilDue = daysUntil(billingDate, now);
      // Isolate per-schedule failures so one bad write doesn't drop reminders
      // for everyone after it (the daily lock prevents a retry).
      try {
        if (row.isSubscription) {
          await this.notificationsService.createRenewalReminder(
            householdId,
            docId,
            row.payee,
            billingDate,
            daysUntilDue,
          );
        } else {
          await this.notificationsService.createBillReminder(
            householdId,
            docId,
            row.payee,
            row.amountCents,
            billingDate,
            daysUntilDue,
          );
        }
        created++;
      } catch (error: unknown) {
        failed++;
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          { recurringId: docId, householdId },
          `Failed to create reminder: ${message}`,
        );
      }
    }

    this.logger.log(
      { checked, created, failed, skipped },
      'Reminder cron job complete',
    );
  }
}
