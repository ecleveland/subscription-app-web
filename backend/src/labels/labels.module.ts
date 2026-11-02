import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LabelsController } from './labels.controller';
import { LabelsService } from './labels.service';
import { Label, LabelSchema } from './schemas/label.schema';
import {
  Transaction,
  TransactionSchema,
} from '../transactions/schemas/transaction.schema';
import {
  RecurringTransaction,
  RecurringTransactionSchema,
} from '../recurring/schemas/recurring-transaction.schema';
import { Goal, GoalSchema } from '../goals/schemas/goal.schema';
import { HouseholdsModule } from '../households/households.module';

// Business labels (VEG-697): the data model, the household label API, and the
// LabelsService that Transactions, Recurring, Goals and Subscriptions use to
// validate a labelId. Transaction, RecurringTransaction and Goal are
// registered schema-only and strictly read-only, for the archive-vs-hard-delete
// reference check. Importing their owning modules instead would be circular,
// because all of them import this module. HouseholdsModule provides the
// HouseholdGuard; it does not import this module, so unlike categories the
// controller can live here without a separate HTTP module.
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Label.name, schema: LabelSchema },
      { name: Transaction.name, schema: TransactionSchema },
      { name: RecurringTransaction.name, schema: RecurringTransactionSchema },
      { name: Goal.name, schema: GoalSchema },
    ]),
    HouseholdsModule,
  ],
  controllers: [LabelsController],
  providers: [LabelsService],
  exports: [LabelsService],
})
export class LabelsModule {}
