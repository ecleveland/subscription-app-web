import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { CronLockModule } from '../common/cron-lock/cron-lock.module';
import { ReconciliationService } from './reconciliation.service';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationCronService } from './reconciliation-cron.service';

// Balance reconciliation (VEG-478): re-derives cached account balances from the
// ledger and corrects drift. Depends on AccountsService (reads the balance view,
// writes corrections via compare-and-set), TransactionsService (sums the ledger
// deltas), and CronLockModule (leader election for the weekly sweep). The
// admin-only guard stack (JwtAuthGuard/RolesGuard) resolves globally, exactly as
// in AdminModule, so no auth/households import is needed here.
//
// No cycle: neither AccountsModule nor TransactionsModule imports this module.
@Module({
  imports: [AccountsModule, TransactionsModule, CronLockModule],
  controllers: [ReconciliationController],
  providers: [ReconciliationService, ReconciliationCronService],
  exports: [ReconciliationService],
})
export class ReconciliationModule {}
