import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import {
  RecurringTransaction,
  RecurringTransactionSchema,
} from '../recurring/schemas/recurring-transaction.schema';
import { HouseholdsModule } from '../households/households.module';
import { CategoriesModule } from '../categories/categories.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: RecurringTransaction.name, schema: RecurringTransactionSchema },
    ]),
    // Provides HouseholdGuard (+ HouseholdsService it depends on) for the
    // household-scoped controller.
    HouseholdsModule,
    // Provides CategoriesService (category-name → categoryId resolution for the
    // adapter).
    CategoriesModule,
  ],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
