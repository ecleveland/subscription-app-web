import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Notification,
  NotificationDocument,
  NotificationType,
} from './schemas/notification.schema';
import { QueryNotificationDto } from './dto/query-notification.dto';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectModel(Notification.name)
    private notificationModel: Model<NotificationDocument>,
  ) {}

  async findAll(
    userId: string,
    query: QueryNotificationDto,
  ): Promise<{ data: NotificationDocument[]; unreadCount: number }> {
    const filter: Record<string, unknown> = {
      userId: new Types.ObjectId(userId),
    };
    if (query.read !== undefined) {
      filter.read = query.read;
    }

    const [data, unreadCount] = await Promise.all([
      this.notificationModel.find(filter).sort({ createdAt: -1 }).exec(),
      this.notificationModel
        .countDocuments({
          userId: new Types.ObjectId(userId),
          read: false,
        } as Record<string, unknown>)
        .exec(),
    ]);

    return { data, unreadCount };
  }

  async getUnreadCount(userId: string): Promise<number> {
    return this.notificationModel
      .countDocuments({
        userId: new Types.ObjectId(userId),
        read: false,
      } as Record<string, unknown>)
      .exec();
  }

  async markAsRead(userId: string, id: string): Promise<NotificationDocument> {
    const notification = await this.notificationModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          userId: new Types.ObjectId(userId),
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

  async markAllAsRead(userId: string): Promise<void> {
    await this.notificationModel
      .updateMany(
        {
          userId: new Types.ObjectId(userId),
          read: false,
        } as Record<string, unknown>,
        { read: true },
      )
      .exec();
  }

  async remove(userId: string, id: string): Promise<void> {
    const result = await this.notificationModel
      .findOneAndDelete({
        _id: new Types.ObjectId(id),
        userId: new Types.ObjectId(userId),
      } as Record<string, unknown>)
      .exec();

    if (!result) {
      throw new NotFoundException('Notification not found');
    }
  }

  async createRenewalReminder(
    userId: string,
    subscriptionId: string,
    subscriptionName: string,
    billingDate: Date,
    daysBefore: number,
  ): Promise<void> {
    try {
      const notification = new this.notificationModel({
        userId: new Types.ObjectId(userId),
        subscriptionId: new Types.ObjectId(subscriptionId),
        type: NotificationType.RENEWAL_REMINDER,
        title: `${subscriptionName} renewing soon`,
        message: `Your ${subscriptionName} subscription renews in ${daysBefore} day${daysBefore === 1 ? '' : 's'}.`,
        billingDate,
        read: false,
      });
      await notification.save();
      this.logger.log(
        { userId, subscriptionId, billingDate },
        'Renewal reminder created',
      );
    } catch (error: unknown) {
      // Silently skip duplicate key errors (notification already exists)
      if (
        error instanceof Error &&
        'code' in error &&
        (error as Record<string, unknown>).code === 11000
      ) {
        return;
      }
      throw error;
    }
  }
}
