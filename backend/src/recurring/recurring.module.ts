import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RecurringController } from './recurring.controller';
import { RecurringService } from './recurring.service';
import {
  RecurringTransaction,
  RecurringTransactionSchema,
} from './schemas/recurring-transaction.schema';
import { AccountsModule } from '../accounts/accounts.module';
import { CategoriesModule } from '../categories/categories.module';
import { HouseholdsModule } from '../households/households.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { CronLockModule } from '../common/cron-lock/cron-lock.module';
import { RecurringCronService } from './recurring-cron.service';

// Phase 4 recurring schedules. Depends on AccountsService/CategoriesService
// (to validate that referenced accounts/categories belong to the household),
// HouseholdsModule (the HouseholdGuard applied after JwtAuthGuard),
// TransactionsModule (materializing due schedules into the ledger, VEG-467)
// and CronLockModule (leader election for the daily scheduler run).
// NotificationsModule (reminders, VEG-468) arrives with the code that needs it.
//
// No cycle: TransactionsModule imports only Accounts/Categories/Households.
@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: RecurringTransaction.name,
        schema: RecurringTransactionSchema,
      },
    ]),
    AccountsModule,
    CategoriesModule,
    HouseholdsModule,
    TransactionsModule,
    CronLockModule,
  ],
  controllers: [RecurringController],
  providers: [RecurringService, RecurringCronService],
  exports: [RecurringService],
})
export class RecurringModule {}
