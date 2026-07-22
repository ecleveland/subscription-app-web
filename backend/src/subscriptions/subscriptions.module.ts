import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsCronService } from './subscriptions-cron.service';
import { SubscriptionsFoldInService } from './subscriptions-fold-in.service';
import {
  Subscription,
  SubscriptionSchema,
} from './schemas/subscription.schema';
import {
  RecurringTransaction,
  RecurringTransactionSchema,
} from '../recurring/schemas/recurring-transaction.schema';
import { CronLockModule } from '../common/cron-lock/cron-lock.module';
import { HouseholdsModule } from '../households/households.module';
import { CategoriesModule } from '../categories/categories.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Subscription.name, schema: SubscriptionSchema },
      // The VEG-469 fold-in writes recurring docs directly (schema validators as
      // the backstop). Registered here, not yet invoked — the boot wiring lands
      // with the controller/cron flip in PR2.
      { name: RecurringTransaction.name, schema: RecurringTransactionSchema },
    ]),
    CronLockModule,
    // Provides HouseholdGuard (+ HouseholdsService it depends on) for the
    // household-scoped controller.
    HouseholdsModule,
    // Provides CategoriesService (category-name → categoryId resolution for the
    // fold-in migration).
    CategoriesModule,
  ],
  controllers: [SubscriptionsController],
  providers: [
    SubscriptionsService,
    SubscriptionsCronService,
    SubscriptionsFoldInService,
  ],
  exports: [SubscriptionsService, SubscriptionsFoldInService],
})
export class SubscriptionsModule {}
