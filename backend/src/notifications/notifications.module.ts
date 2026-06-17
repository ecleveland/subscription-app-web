import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsCronService } from './notifications-cron.service';
import {
  Notification,
  NotificationSchema,
} from './schemas/notification.schema';
import {
  Subscription,
  SubscriptionSchema,
} from '../subscriptions/schemas/subscription.schema';
import { CronLockModule } from '../common/cron-lock/cron-lock.module';
import { HouseholdsModule } from '../households/households.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
    ]),
    CronLockModule,
    // Provides HouseholdGuard (+ HouseholdsService it depends on) for the
    // household-scoped controller.
    HouseholdsModule,
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsCronService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
