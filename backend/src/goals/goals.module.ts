import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GoalsController } from './goals.controller';
import { GoalsService } from './goals.service';
import { Goal, GoalSchema } from './schemas/goal.schema';
import { CategoriesModule } from '../categories/categories.module';
import { HouseholdsModule } from '../households/households.module';

// Phase 5 savings and debt goals (VEG-585). CategoriesModule validates that a
// goal's category belongs to the household. HouseholdsModule provides the
// HouseholdGuard.
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Goal.name, schema: GoalSchema }]),
    CategoriesModule,
    HouseholdsModule,
  ],
  controllers: [GoalsController],
  providers: [GoalsService],
  exports: [GoalsService],
})
export class GoalsModule {}
