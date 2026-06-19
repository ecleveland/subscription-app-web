import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BudgetsController } from './budgets.controller';
import { BudgetsService } from './budgets.service';
import { Budget, BudgetSchema } from './schemas/budget.schema';
import {
  BudgetCategory,
  BudgetCategorySchema,
} from './schemas/budget-category.schema';

// Phase 3: the Budget / BudgetCategory data model and module scaffold (VEG-438).
// The monthly-limit CRUD and budget-vs-actual reader land in VEG-439; the
// service is exported so that work (and any future reporting) can build on it.
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Budget.name, schema: BudgetSchema },
      { name: BudgetCategory.name, schema: BudgetCategorySchema },
    ]),
  ],
  controllers: [BudgetsController],
  providers: [BudgetsService],
  exports: [BudgetsService],
})
export class BudgetsModule {}
