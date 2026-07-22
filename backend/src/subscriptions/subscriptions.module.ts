import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsFoldInService } from './subscriptions-fold-in.service';
import {
  Subscription,
  SubscriptionSchema,
} from './schemas/subscription.schema';
import {
  RecurringTransaction,
  RecurringTransactionSchema,
} from '../recurring/schemas/recurring-transaction.schema';
import { HouseholdsModule } from '../households/households.module';
import { CategoriesModule } from '../categories/categories.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      // Subscriptions are now the isSubscription slice of RecurringTransaction
      // (VEG-469); the Subscription model is retained only for the frozen
      // archive the fold-in migration reads/stamps.
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: RecurringTransaction.name, schema: RecurringTransactionSchema },
    ]),
    // Provides HouseholdGuard (+ HouseholdsService it depends on) for the
    // household-scoped controller.
    HouseholdsModule,
    // Provides CategoriesService (category-name → categoryId resolution for the
    // adapter and the fold-in migration).
    CategoriesModule,
  ],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService, SubscriptionsFoldInService],
  exports: [SubscriptionsService, SubscriptionsFoldInService],
})
export class SubscriptionsModule {}
