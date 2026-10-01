import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Notification,
  NotificationDocument,
  NotificationType,
} from './schemas/notification.schema';
import { QueryNotificationDto } from './dto/query-notification.dto';

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

// Integer cents to "$1,234.56".
function formatMoney(amountCents: number): string {
  return usd.format(amountCents / 100);
}

// Schedule dates are stored at UTC midnight, so format in UTC or a server west
// of Greenwich would print the day before.
function formatDueDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectModel(Notification.name)
    private notificationModel: Model<NotificationDocument>,
  ) {}

  async findAll(
    householdId: string,
    query: QueryNotificationDto,
  ): Promise<{ data: NotificationDocument[]; unreadCount: number }> {
    const filter: Record<string, unknown> = {
      householdId: new Types.ObjectId(householdId),
    };
    if (query.read !== undefined) {
      filter.read = query.read;
    }

    const [data, unreadCount] = await Promise.all([
      this.notificationModel.find(filter).sort({ createdAt: -1 }).exec(),
      this.notificationModel
        .countDocuments({
          householdId: new Types.ObjectId(householdId),
          read: false,
        } as Record<string, unknown>)
        .exec(),
    ]);

    return { data, unreadCount };
  }

  async getUnreadCount(householdId: string): Promise<number> {
    return this.notificationModel
      .countDocuments({
        householdId: new Types.ObjectId(householdId),
        read: false,
      } as Record<string, unknown>)
      .exec();
  }

  async markAsRead(
    householdId: string,
    id: string,
  ): Promise<NotificationDocument> {
    const notification = await this.notificationModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          householdId: new Types.ObjectId(householdId),
        } as Record<string, unknown>,
        { read: true },
        { new: true },
      )
      .exec();

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    return notification;
  }

  async markAllAsRead(householdId: string): Promise<void> {
    await this.notificationModel
      .updateMany(
        {
          householdId: new Types.ObjectId(householdId),
          read: false,
        } as Record<string, unknown>,
        { read: true },
      )
      .exec();
  }

  async remove(householdId: string, id: string): Promise<void> {
    const result = await this.notificationModel
      .findOneAndDelete({
        _id: new Types.ObjectId(id),
        householdId: new Types.ObjectId(householdId),
      } as Record<string, unknown>)
      .exec();

    if (!result) {
      throw new NotFoundException('Notification not found');
    }
  }

  async createRenewalReminder(
    householdId: string,
    subscriptionId: string,
    subscriptionName: string,
    billingDate: Date,
    daysUntilDue: number,
  ): Promise<void> {
    // Idempotent upsert keyed on the unique { householdId, subscriptionId,
    // billingDate } index. Concurrent or repeated cron runs converge on a
    // single notification without relying on catching duplicate-key errors.
    const result = await this.notificationModel
      .updateOne(
        {
          householdId: new Types.ObjectId(householdId),
          subscriptionId: new Types.ObjectId(subscriptionId),
          billingDate,
        } as Record<string, unknown>,
        {
          $setOnInsert: {
            type: NotificationType.RENEWAL_REMINDER,
            title: `${subscriptionName} renewing soon`,
            message: `Your ${subscriptionName} subscription renews in ${daysUntilDue} day${daysUntilDue === 1 ? '' : 's'}.`,
            read: false,
          },
        },
        { upsert: true },
      )
      .exec();

    if (result.upsertedCount > 0) {
      this.logger.log(
        { householdId, subscriptionId, billingDate },
        'Renewal reminder created',
      );
    }
  }

  /**
   * Upsert a "due soon" reminder for a non-subscription schedule (bill or
   * income, VEG-468). Shares the { householdId, subscriptionId, billingDate }
   * unique key with renewal reminders, so each schedule gets at most one
   * reminder per occurrence whichever path wrote it.
   */
  async createBillReminder(
    householdId: string,
    recurringId: string,
    payee: string,
    amountCents: number,
    billingDate: Date,
    daysUntilDue: number,
  ): Promise<void> {
    const result = await this.notificationModel
      .updateOne(
        {
          householdId: new Types.ObjectId(householdId),
          subscriptionId: new Types.ObjectId(recurringId),
          billingDate,
        } as Record<string, unknown>,
        {
          $setOnInsert: {
            type: NotificationType.BILL_REMINDER,
            title: `${payee} due in ${daysUntilDue} day${daysUntilDue === 1 ? '' : 's'}`,
            message: `${payee} — ${formatMoney(amountCents)} due on ${formatDueDate(billingDate)}`,
            read: false,
          },
        },
        { upsert: true },
      )
      .exec();

    if (result.upsertedCount > 0) {
      this.logger.log(
        { householdId, recurringId, billingDate },
        'Bill reminder created',
      );
    }
  }

  /**
   * Delete every notification belonging to a household — the household-scoped
   * deletion cascade primitive (e.g. for household teardown).
   */
  async removeAllByHouseholdId(householdId: string): Promise<number> {
    const result = await this.notificationModel
      .deleteMany({ householdId: new Types.ObjectId(householdId) } as Record<
        string,
        unknown
      >)
      .exec();
    return result.deletedCount;
  }
}
