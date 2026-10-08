import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import {
  Transaction,
  TransactionSchema,
} from '../transactions/schemas/transaction.schema';
import { HouseholdsModule } from '../households/households.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { BudgetsModule } from '../budgets/budgets.module';
import { CategoriesModule } from '../categories/categories.module';

// Phase 5 reports (VEG-582 onward). Read-only. Cash flow aggregates the
// Transaction collection directly. Spending reuses the per-category actuals
// from TransactionsService, planned amounts from BudgetsService, and names
// from CategoriesService so it matches the budget view. None of those modules
// import ReportsModule, so the graph stays acyclic. HouseholdsModule provides
// the HouseholdGuard.
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Transaction.name, schema: TransactionSchema },
    ]),
    HouseholdsModule,
    TransactionsModule,
    BudgetsModule,
    CategoriesModule,
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
