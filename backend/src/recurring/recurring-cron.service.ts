import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RecurringService } from './recurring.service';
import { CronLockService } from '../common/cron-lock/cron-lock.service';

// The daily materialization scheduler (VEG-467): turns due recurring schedules
// into real ledger transactions. Structurally a twin of SubscriptionsCronService
// — a thin leader-election shell over a service method, with the domain logic
// living in RecurringService, which owns the model.
@Injectable()
export class RecurringCronService {
  private readonly logger = new Logger(RecurringCronService.name);
  // Distinct from the subscriptions cron's key: sharing one would let whichever
  // job ran first suppress the other for the remainder of the day.
  static readonly LOCK_KEY = 'materialize-recurring';

  constructor(
    private readonly recurringService: RecurringService,
    private readonly cronLock: CronLockService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleMaterialization(): Promise<void> {
    const runDate = CronLockService.runDateKey();

    // Leader election: only one instance materializes per day.
    const acquired = await this.cronLock.tryAcquire(
      RecurringCronService.LOCK_KEY,
      runDate,
    );
    if (!acquired) {
      this.logger.log(
        'Recurring materialization already handled by another instance; skipping',
      );
      return;
    }

    this.logger.log('Running recurring materialization cron job');
    const summary = await this.recurringService.materializeDue();
    this.logger.log(summary, 'Recurring materialization complete');
  }
}
