import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsCronService } from './subscriptions-cron.service';
import {
  Subscription,
  SubscriptionSchema,
} from './schemas/subscription.schema';
import { CronLockModule } from '../common/cron-lock/cron-lock.module';
import { HouseholdsModule } from '../households/households.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Subscription.name, schema: SubscriptionSchema },
    ]),
    CronLockModule,
    // Provides HouseholdGuard (+ HouseholdsService it depends on) for the
    // household-scoped controller.
    HouseholdsModule,
  ],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService, SubscriptionsCronService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
