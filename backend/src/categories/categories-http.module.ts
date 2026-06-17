import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { CategoriesModule } from './categories.module';
import { HouseholdsModule } from '../households/households.module';

// Hosts the read-only categories HTTP API. Kept separate from CategoriesModule
// (which HouseholdsModule imports for seeding) so importing HouseholdsModule
// here — for the HouseholdGuard — doesn't create a circular module dependency.
@Module({
  imports: [CategoriesModule, HouseholdsModule],
  controllers: [CategoriesController],
})
export class CategoriesHttpModule {}
