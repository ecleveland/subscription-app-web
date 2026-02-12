import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
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
    createDto: CreateSubscriptionDto,
  ): Promise<SubscriptionDocument> {
    const subscription = new this.subscriptionModel(createDto);
    return subscription.save();
  }

  async findAll(query: QuerySubscriptionDto): Promise<SubscriptionDocument[]> {
    const filter: Record<string, unknown> = {};

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

  async findOne(id: string): Promise<SubscriptionDocument> {
    const subscription = await this.subscriptionModel.findById(id).exec();
    if (!subscription) {
      throw new NotFoundException(`Subscription with ID "${id}" not found`);
    }
    return subscription;
  }

  async update(
    id: string,
    updateDto: UpdateSubscriptionDto,
  ): Promise<SubscriptionDocument> {
    const subscription = await this.subscriptionModel
      .findByIdAndUpdate(id, updateDto, { new: true, runValidators: true })
      .exec();
    if (!subscription) {
      throw new NotFoundException(`Subscription with ID "${id}" not found`);
    }
    return subscription;
  }

  async remove(id: string): Promise<void> {
    const result = await this.subscriptionModel.findByIdAndDelete(id).exec();
    if (!result) {
      throw new NotFoundException(`Subscription with ID "${id}" not found`);
    }
  }
}
