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

// Phase 2 foundation: the category data model + default-set seeding. The HTTP
// API for browsing/managing categories arrives with the Phase 3 budgeting epic;
// here CategoriesService is exported so HouseholdsService can seed defaults at
// household creation and the bootstrap can backfill existing households. The
// Household model is registered read-only for that backfill enumeration.
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CategoryGroup.name, schema: CategoryGroupSchema },
      { name: Category.name, schema: CategorySchema },
      { name: Household.name, schema: HouseholdSchema },
    ]),
  ],
  providers: [CategoriesService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
