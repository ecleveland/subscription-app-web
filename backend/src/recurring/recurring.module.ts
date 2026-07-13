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

// Phase 4 recurring schedules. Depends on AccountsService/CategoriesService
// (to validate that referenced accounts/categories belong to the household)
// and HouseholdsModule (the HouseholdGuard applied after JwtAuthGuard).
// TransactionsModule (materialization, VEG-467) and NotificationsModule
// (reminders, VEG-468) arrive with the code that needs them.
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
  ],
  controllers: [RecurringController],
  providers: [RecurringService],
  exports: [RecurringService],
})
export class RecurringModule {}
