import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RecurringController } from './recurring.controller';
import { RecurringService } from './recurring.service';
import {
  RecurringTransaction,
  RecurringTransactionSchema,
} from './schemas/recurring-transaction.schema';

// Phase 4 scaffold (VEG-465): model registration and the empty
// controller/service pair. Deliberately minimal — HouseholdsModule (guards),
// TransactionsModule (materialization), and NotificationsModule (reminders)
// arrive with VEG-466/467/468 alongside the code that needs them.
@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: RecurringTransaction.name,
        schema: RecurringTransactionSchema,
      },
    ]),
  ],
  controllers: [RecurringController],
  providers: [RecurringService],
  exports: [RecurringService],
})
export class RecurringModule {}
