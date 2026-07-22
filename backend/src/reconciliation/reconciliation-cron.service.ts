import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ReconciliationService } from './reconciliation.service';
import { CronLockService } from '../common/cron-lock/cron-lock.service';
import type { ReconciliationSummary } from './interfaces/reconciliation-report.interface';

// The weekly self-healing balance sweep (VEG-478): turns "drift nobody reads"
// into "drift that gets corrected". Structurally a twin of RecurringCronService
// — a thin leader-election shell over ReconciliationService.reconcile, so only
// one instance runs the sweep per fire.
@Injectable()
export class ReconciliationCronService {
  private readonly logger = new Logger(ReconciliationCronService.name);
  // Distinct from the other cron keys so it never suppresses (or is suppressed
  // by) the recurring-materialization or subscription jobs.
  static readonly LOCK_KEY = 'reconcile-balances';

  constructor(
    private readonly reconciliationService: ReconciliationService,
    private readonly cronLock: CronLockService,
  ) {}

  @Cron(CronExpression.EVERY_WEEK)
  async handleReconciliation(): Promise<void> {
    const runDate = CronLockService.runDateKey();

    // Leader election: only one instance sweeps per weekly fire. The 48h lock
    // TTL is far shorter than the weekly cadence, so a stale lock never blocks
    // the next run.
    const acquired = await this.cronLock.tryAcquire(
      ReconciliationCronService.LOCK_KEY,
      runDate,
    );
    if (!acquired) {
      this.logger.log(
        'Balance reconciliation already handled by another instance; skipping',
      );
      return;
    }

    this.logger.log('Running weekly balance reconciliation sweep');
    let summary: ReconciliationSummary;
    try {
      summary = await this.reconciliationService.reconcile();
    } catch (error: unknown) {
      // Contain the failure at the cron boundary: an escaping rejection from a
      // job that writes money would surface only as an unhandled rejection, and
      // nothing installs a global handler.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Balance reconciliation sweep failed: ${message}`);
      return;
    }

    // Escalate so an operator filtering to warn+ sees when the sweep actually
    // corrected drift (which means an online `$inc` was previously lost).
    const level =
      summary.corrected > 0 || summary.skippedConcurrent > 0 ? 'warn' : 'log';
    this.logger[level](summary, 'Weekly balance reconciliation complete');
  }
}
