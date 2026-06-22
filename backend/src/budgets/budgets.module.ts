import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BudgetsController } from './budgets.controller';
import { BudgetsService } from './budgets.service';
import { Budget, BudgetSchema } from './schemas/budget.schema';
import {
  BudgetCategory,
  BudgetCategorySchema,
} from './schemas/budget-category.schema';
import { TransactionsModule } from '../transactions/transactions.module';
import { CategoriesModule } from '../categories/categories.module';
import { HouseholdsModule } from '../households/households.module';

// Phase 3: the budget-vs-actual API (VEG-439), built on the Budget /
// BudgetCategory model scaffolded in VEG-438. Depends on TransactionsService (to
// aggregate monthly actuals from the ledger) and CategoriesService (to resolve
// each category's isIncome flag and validate cross-household writes);
// HouseholdsModule provides the HouseholdGuard the controller applies after
// JwtAuthGuard. None of these import BudgetsModule, so the graph is acyclic.
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Budget.name, schema: BudgetSchema },
      { name: BudgetCategory.name, schema: BudgetCategorySchema },
    ]),
    TransactionsModule,
    CategoriesModule,
    HouseholdsModule,
  ],
  controllers: [BudgetsController],
  providers: [BudgetsService],
  exports: [BudgetsService],
})
export class BudgetsModule {}
