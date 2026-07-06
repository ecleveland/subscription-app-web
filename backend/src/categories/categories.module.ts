import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CategoriesService } from './categories.service';
import {
  CategoryGroup,
  CategoryGroupSchema,
} from './schemas/category-group.schema';
import { Category, CategorySchema } from './schemas/category.schema';
import {
  Household,
  HouseholdSchema,
} from '../households/schemas/household.schema';
import {
  Transaction,
  TransactionSchema,
} from '../transactions/schemas/transaction.schema';
import {
  BudgetCategory,
  BudgetCategorySchema,
} from '../budgets/schemas/budget-category.schema';

// The category data model, default-set seeding (Phase 2), and household
// category management (Phase 3, VEG-437). CategoriesService is exported so
// HouseholdsService can seed defaults at household creation and the bootstrap
// can backfill existing households. Foreign models are registered schema-only:
// Household for the backfill enumeration and for writing the seeded stamp
// (its only write here); Transaction and BudgetCategory strictly read-only for
// the archive-vs-hard-delete reference check. Importing their owning modules
// instead would be circular — both import this module.
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CategoryGroup.name, schema: CategoryGroupSchema },
      { name: Category.name, schema: CategorySchema },
      { name: Household.name, schema: HouseholdSchema },
      { name: Transaction.name, schema: TransactionSchema },
      { name: BudgetCategory.name, schema: BudgetCategorySchema },
    ]),
  ],
  providers: [CategoriesService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
