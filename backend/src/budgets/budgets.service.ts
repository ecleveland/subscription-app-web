import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Budget, BudgetDocument } from './schemas/budget.schema';
import {
  BudgetCategory,
  BudgetCategoryDocument,
} from './schemas/budget-category.schema';

// Phase 3 scaffold (VEG-438): the data model and module wiring only. The budget
// CRUD and the budget-vs-actual reader (planned limits + actuals aggregated from
// the transaction ledger + derived "to be budgeted") land in VEG-439 and build
// on the models injected here.
@Injectable()
export class BudgetsService {
  private readonly logger = new Logger(BudgetsService.name);

  constructor(
    @InjectModel(Budget.name)
    private readonly budgetModel: Model<BudgetDocument>,
    @InjectModel(BudgetCategory.name)
    private readonly budgetCategoryModel: Model<BudgetCategoryDocument>,
  ) {}
}
