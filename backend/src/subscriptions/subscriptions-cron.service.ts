import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SubscriptionsService } from './subscriptions.service';
import { CronLockService } from '../common/cron-lock/cron-lock.service';

@Injectable()
export class SubscriptionsCronService {
  private readonly logger = new Logger(SubscriptionsCronService.name);
  static readonly LOCK_KEY = 'advance-overdue-dates';

  constructor(
    private readonly subscriptionsService: SubscriptionsService,
    private readonly cronLock: CronLockService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleOverdueAdvancement(): Promise<void> {
    const runDate = CronLockService.runDateKey();

    // Leader election: only one instance advances overdue dates per day.
    const acquired = await this.cronLock.tryAcquire(
      SubscriptionsCronService.LOCK_KEY,
      runDate,
    );
    if (!acquired) {
      this.logger.log(
        'Overdue-advancement cron already handled by another instance; skipping',
      );
      return;
    }

    this.logger.log('Running overdue billing-date advancement cron job');
    const advanced = await this.subscriptionsService.advanceOverdueDates();
    this.logger.log({ advanced }, 'Overdue billing-date advancement complete');
  }
}
