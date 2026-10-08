import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import {
  Transaction,
  TransactionSchema,
} from '../transactions/schemas/transaction.schema';
import { HouseholdsModule } from '../households/households.module';

// Phase 5 reports (VEG-582 onward). Reads the Transaction collection directly
// with aggregations; it never writes, so it skips TransactionsService and its
// balance bookkeeping. HouseholdsModule provides the HouseholdGuard.
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Transaction.name, schema: TransactionSchema },
    ]),
    HouseholdsModule,
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
