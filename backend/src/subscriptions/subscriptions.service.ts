import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Subscription,
  SubscriptionDocument,
} from './schemas/subscription.schema';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';
import { QuerySubscriptionDto } from './dto/query-subscription.dto';

@Injectable()
export class SubscriptionsService {
  constructor(
    @InjectModel(Subscription.name)
    private subscriptionModel: Model<SubscriptionDocument>,
  ) {}

  async create(
    userId: string,
    createDto: CreateSubscriptionDto,
  ): Promise<SubscriptionDocument> {
    const subscription = new this.subscriptionModel({
      ...createDto,
      userId: new Types.ObjectId(userId),
    });
    return subscription.save();
  }

  async findAll(
    userId: string,
    query: QuerySubscriptionDto,
  ): Promise<SubscriptionDocument[]> {
    const filter: Record<string, unknown> = {
      userId: new Types.ObjectId(userId),
    };

    if (query.category) {
      filter.category = query.category;
    }
    if (query.billingCycle) {
      filter.billingCycle = query.billingCycle;
    }

    const sortBy = query.sortBy || 'createdAt';
    const sortOrder = query.sortOrder === 'asc' ? 1 : -1;

    return this.subscriptionModel
      .find(filter)
      .sort({ [sortBy]: sortOrder })
      .exec();
  }

  async findOne(userId: string, id: string): Promise<SubscriptionDocument> {
    const subscription = await this.subscriptionModel.findById(id).exec();
    if (
      !subscription ||
      !subscription.userId ||
      !new Types.ObjectId(userId).equals(
        subscription.userId as unknown as Types.ObjectId,
      )
    ) {
      throw new NotFoundException(`Subscription with ID "${id}" not found`);
    }
    return subscription;
  }

  async update(
    userId: string,
    id: string,
    updateDto: UpdateSubscriptionDto,
  ): Promise<SubscriptionDocument> {
    const existing = await this.findOne(userId, id);
    Object.assign(existing, updateDto);
    return existing.save();
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.findOne(userId, id);
    await this.subscriptionModel.findByIdAndDelete(id).exec();
  }

  async migrateUnownedSubscriptions(adminUserId: string): Promise<number> {
    const result = await this.subscriptionModel
      .updateMany({ userId: { $exists: false } } as Record<string, unknown>, {
        $set: { userId: new Types.ObjectId(adminUserId) },
      })
      .exec();
    return result.modifiedCount;
  }
}
