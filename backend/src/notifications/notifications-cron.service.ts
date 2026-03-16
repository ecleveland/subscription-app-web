import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Subscription,
  SubscriptionDocument,
} from '../subscriptions/schemas/subscription.schema';
import { NotificationsService } from './notifications.service';

@Injectable()
export class NotificationsCronService {
  private readonly logger = new Logger(NotificationsCronService.name);

  constructor(
    @InjectModel(Subscription.name)
    private subscriptionModel: Model<SubscriptionDocument>,
    private notificationsService: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async handleRenewalReminders(): Promise<void> {
    this.logger.log('Running renewal reminder cron job');

    const now = new Date();
    const maxWindow = new Date();
    maxWindow.setDate(maxWindow.getDate() + 30);

    const subscriptions = await this.subscriptionModel
      .find({
        isActive: true,
        reminderDaysBefore: { $gt: 0 },
        nextBillingDate: { $gte: now, $lte: maxWindow },
      } as Record<string, unknown>)
      .exec();

    let created = 0;
    for (const sub of subscriptions) {
      const billingDate = new Date(sub.nextBillingDate);
      const reminderDate = new Date(billingDate);
      reminderDate.setDate(reminderDate.getDate() - sub.reminderDaysBefore);

      if (reminderDate <= now) {
        const docId = (
          sub as unknown as { _id: { toHexString(): string } }
        )._id.toHexString();
        const ownerId = (
          sub.userId as unknown as { toHexString(): string }
        ).toHexString();
        await this.notificationsService.createRenewalReminder(
          ownerId,
          docId,
          sub.name,
          billingDate,
          sub.reminderDaysBefore,
        );
        created++;
      }
    }

    this.logger.log(
      { checked: subscriptions.length, created },
      'Renewal reminder cron job complete',
    );
  }
}
