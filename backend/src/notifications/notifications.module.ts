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
  RecurringTransaction,
  RecurringTransactionSchema,
} from '../recurring/schemas/recurring-transaction.schema';
import { CronLockModule } from '../common/cron-lock/cron-lock.module';
import { HouseholdsModule } from '../households/households.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
      // Renewal reminders now read the subscription slice of recurring (VEG-469).
      { name: RecurringTransaction.name, schema: RecurringTransactionSchema },
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
