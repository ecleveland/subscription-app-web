import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { SubscriptionsService } from './subscriptions.service';
import { Subscription, BillingCycle } from './schemas/subscription.schema';
import { BulkAction } from './dto/bulk-operation.dto';

function createChainable(resolvedValue: any = null) {
  const chain: any = {};
  chain.sort = jest.fn().mockReturnValue(chain);
  chain.skip = jest.fn().mockReturnValue(chain);
  chain.limit = jest.fn().mockReturnValue(chain);
  chain.exec = jest.fn().mockResolvedValue(resolvedValue);
  return chain;
}

describe('SubscriptionsService', () => {
  let service: SubscriptionsService;
  let mockSubModel: any;

  const userId = '507f1f77bcf86cd799439011';
  const subId = '507f1f77bcf86cd799439022';

  const mockSubscription = {
    _id: subId,
    userId: new Types.ObjectId(userId),
    name: 'Netflix',
    cost: 15.99,
    billingCycle: BillingCycle.MONTHLY,
    nextBillingDate: new Date('2025-06-01'),
    category: 'Streaming',
    isActive: true,
    save: jest.fn(),
  };

  beforeEach(async () => {
    mockSubModel = jest.fn().mockImplementation((dto) => ({
      ...dto,
      save: jest.fn().mockResolvedValue({ _id: 'new-id', ...dto }),
    }));
    mockSubModel.find = jest.fn().mockReturnValue(createChainable([]));
    mockSubModel.findById = jest.fn().mockReturnValue(createChainable(null));
    mockSubModel.findByIdAndDelete = jest
      .fn()
      .mockReturnValue(createChainable(null));
    mockSubModel.findOneAndDelete = jest
      .fn()
      .mockReturnValue(createChainable(null));
    mockSubModel.countDocuments = jest.fn().mockReturnValue(createChainable(0));
    mockSubModel.bulkWrite = jest.fn().mockResolvedValue({ modifiedCount: 0 });
    mockSubModel.updateMany = jest
      .fn()
      .mockReturnValue(createChainable({ modifiedCount: 0 }));
    mockSubModel.deleteMany = jest
      .fn()
      .mockReturnValue(createChainable({ deletedCount: 0 }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        {
          provide: getModelToken(Subscription.name),
          useValue: mockSubModel,
        },
      ],
    }).compile();

    service = module.get<SubscriptionsService>(SubscriptionsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a subscription with userId as ObjectId and log', async () => {
      const dto = {
        name: 'Netflix',
        cost: 15.99,
        billingCycle: BillingCycle.MONTHLY,
        nextBillingDate: '2025-06-01',
        category: 'Streaming',
      };
      const saveMock = jest.fn().mockResolvedValue({
        _id: { toString: () => 'new-id' },
        ...dto,
        userId,
      });
      mockSubModel.mockImplementation((data: any) => ({
        ...data,
        save: saveMock,
      }));
      const logSpy = jest.spyOn(Logger.prototype, 'log');

      await service.create(userId, dto);

      expect(mockSubModel).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Netflix',
          cost: 15.99,
          userId: expect.any(Types.ObjectId),
        }),
      );
      expect(saveMock).toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(
        { userId, subscriptionId: 'new-id' },
        'Subscription created',
      );
    });
  });

  describe('advanceOverdueDates', () => {
    it('should advance a monthly subscription one month via bulkWrite', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2025-07-15T12:00:00Z'));

      const overdueSub = {
        ...mockSubscription,
        _id: subId,
        nextBillingDate: new Date('2025-07-01'),
        billingCycle: BillingCycle.MONTHLY,
      };
      mockSubModel.find.mockReturnValueOnce(createChainable([overdueSub]));

      await service.advanceOverdueDates(userId);

      expect(mockSubModel.bulkWrite).toHaveBeenCalledWith([
        {
          updateOne: {
            filter: {
              _id: subId,
              nextBillingDate: { $lte: expect.any(Date) },
            },
            update: { $set: { nextBillingDate: expect.any(Date) } },
          },
        },
      ]);
      const newDate =
        mockSubModel.bulkWrite.mock.calls[0][0][0].updateOne.update.$set
          .nextBillingDate;
      expect(newDate.getUTCMonth()).toBe(7); // August
      expect(newDate.getUTCDate()).toBe(1);

      jest.useRealTimers();
    });

    it('should advance a monthly subscription multiple months when needed', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2025-07-15T12:00:00Z'));

      const overdueSub = {
        ...mockSubscription,
        _id: subId,
        nextBillingDate: new Date('2025-03-01'),
        billingCycle: BillingCycle.MONTHLY,
      };
      mockSubModel.find.mockReturnValueOnce(createChainable([overdueSub]));

      await service.advanceOverdueDates(userId);

      const newDate =
        mockSubModel.bulkWrite.mock.calls[0][0][0].updateOne.update.$set
          .nextBillingDate;
      expect(newDate.getUTCMonth()).toBe(7); // August
      expect(newDate.getUTCFullYear()).toBe(2025);

      jest.useRealTimers();
    });

    it('should advance a yearly subscription', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2025-07-15T12:00:00Z'));

      const overdueSub = {
        ...mockSubscription,
        _id: subId,
        nextBillingDate: new Date('2024-06-01'),
        billingCycle: BillingCycle.YEARLY,
      };
      mockSubModel.find.mockReturnValueOnce(createChainable([overdueSub]));

      await service.advanceOverdueDates(userId);

      // June 2024 → June 2025 (still <= July 15) → June 2026
      const newDate =
        mockSubModel.bulkWrite.mock.calls[0][0][0].updateOne.update.$set
          .nextBillingDate;
      expect(newDate.getUTCFullYear()).toBe(2026);
      expect(newDate.getUTCMonth()).toBe(5); // June

      jest.useRealTimers();
    });

    it('should handle month-end edge case (Jan 31 -> Feb 28)', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2025-02-15T12:00:00Z'));

      const overdueSub = {
        ...mockSubscription,
        _id: subId,
        nextBillingDate: new Date('2025-01-31'),
        billingCycle: BillingCycle.MONTHLY,
      };
      mockSubModel.find.mockReturnValueOnce(createChainable([overdueSub]));

      await service.advanceOverdueDates(userId);

      const newDate =
        mockSubModel.bulkWrite.mock.calls[0][0][0].updateOne.update.$set
          .nextBillingDate;
      expect(newDate.getUTCMonth()).toBe(1); // February
      expect(newDate.getUTCDate()).toBe(28);

      jest.useRealTimers();
    });

    it('should restore original day-of-month when month supports it (Jan 31 -> Feb 28 -> Mar 31)', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2025-03-15T12:00:00Z'));

      const overdueSub = {
        ...mockSubscription,
        _id: subId,
        nextBillingDate: new Date('2025-01-31'),
        billingCycle: BillingCycle.MONTHLY,
      };
      mockSubModel.find.mockReturnValueOnce(createChainable([overdueSub]));

      await service.advanceOverdueDates(userId);

      // Jan 31 → Feb 28 (still <= Mar 15) → Mar 31 (> Mar 15, stop)
      const newDate =
        mockSubModel.bulkWrite.mock.calls[0][0][0].updateOne.update.$set
          .nextBillingDate;
      expect(newDate.getUTCMonth()).toBe(2); // March
      expect(newDate.getUTCDate()).toBe(31);

      jest.useRealTimers();
    });

    it('should handle leap year edge case (Feb 29 -> Feb 28 next year)', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2025-03-01T12:00:00Z'));

      const overdueSub = {
        ...mockSubscription,
        _id: subId,
        nextBillingDate: new Date('2024-02-29'),
        billingCycle: BillingCycle.YEARLY,
      };
      mockSubModel.find.mockReturnValueOnce(createChainable([overdueSub]));

      await service.advanceOverdueDates(userId);

      // Feb 29, 2024 → Feb 28, 2025 (still <= Mar 1) → Feb 28, 2026
      const newDate =
        mockSubModel.bulkWrite.mock.calls[0][0][0].updateOne.update.$set
          .nextBillingDate;
      expect(newDate.getUTCMonth()).toBe(1); // February
      expect(newDate.getUTCDate()).toBe(28);
      expect(newDate.getUTCFullYear()).toBe(2026);

      jest.useRealTimers();
    });

    it('should advance a weekly subscription by 7 days', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2025-07-15T12:00:00Z'));

      const overdueSub = {
        ...mockSubscription,
        _id: subId,
        nextBillingDate: new Date('2025-07-10'),
        billingCycle: BillingCycle.WEEKLY,
      };
      mockSubModel.find.mockReturnValueOnce(createChainable([overdueSub]));

      await service.advanceOverdueDates(userId);

      expect(mockSubModel.bulkWrite).toHaveBeenCalled();
      const newDate =
        mockSubModel.bulkWrite.mock.calls[0][0][0].updateOne.update.$set
          .nextBillingDate;
      expect(newDate.getUTCDate()).toBe(17);
      expect(newDate.getUTCMonth()).toBe(6); // July

      jest.useRealTimers();
    });

    it('should advance a weekly subscription multiple weeks when needed', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2025-07-15T12:00:00Z'));

      const overdueSub = {
        ...mockSubscription,
        _id: subId,
        nextBillingDate: new Date('2025-06-15'),
        billingCycle: BillingCycle.WEEKLY,
      };
      mockSubModel.find.mockReturnValueOnce(createChainable([overdueSub]));

      await service.advanceOverdueDates(userId);

      // June 15 + (4*7=28) = July 13 (still <= July 15), + 7 = July 20
      const newDate =
        mockSubModel.bulkWrite.mock.calls[0][0][0].updateOne.update.$set
          .nextBillingDate;
      expect(newDate.getUTCDate()).toBe(20);
      expect(newDate.getUTCMonth()).toBe(6); // July

      jest.useRealTimers();
    });

    it('should advance weekly subscription across month boundary', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2025-08-03T12:00:00Z'));

      const overdueSub = {
        ...mockSubscription,
        _id: subId,
        nextBillingDate: new Date('2025-07-28'),
        billingCycle: BillingCycle.WEEKLY,
      };
      mockSubModel.find.mockReturnValueOnce(createChainable([overdueSub]));

      await service.advanceOverdueDates(userId);

      // July 28 + 7 = August 4
      const newDate =
        mockSubModel.bulkWrite.mock.calls[0][0][0].updateOne.update.$set
          .nextBillingDate;
      expect(newDate.getUTCDate()).toBe(4);
      expect(newDate.getUTCMonth()).toBe(7); // August

      jest.useRealTimers();
    });

    it('should not call bulkWrite when no overdue subscriptions exist', async () => {
      mockSubModel.find.mockReturnValueOnce(createChainable([]));

      await service.advanceOverdueDates(userId);

      expect(mockSubModel.bulkWrite).not.toHaveBeenCalled();
    });

    it('should only query active subscriptions with past billing dates', async () => {
      mockSubModel.find.mockReturnValueOnce(createChainable([]));

      await service.advanceOverdueDates(userId);

      expect(mockSubModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          isActive: true,
          nextBillingDate: { $lte: expect.any(Date) },
        }),
      );
    });

    it('should include atomic guard in bulkWrite filter', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2025-07-15T12:00:00Z'));

      const overdueSub = {
        ...mockSubscription,
        _id: subId,
        nextBillingDate: new Date('2025-07-01'),
        billingCycle: BillingCycle.MONTHLY,
      };
      mockSubModel.find.mockReturnValueOnce(createChainable([overdueSub]));

      await service.advanceOverdueDates(userId);

      const filter =
        mockSubModel.bulkWrite.mock.calls[0][0][0].updateOne.filter;
      expect(filter._id).toBe(subId);
      expect(filter.nextBillingDate).toEqual({ $lte: expect.any(Date) });

      jest.useRealTimers();
    });
  });

  describe('findAll', () => {
    // Each test mocks find twice: first call for advanceOverdueDates (returns []),
    // second call for the main query. Also mocks countDocuments.
    it('should filter by userId', async () => {
      const advanceChain = createChainable([]);
      const chain = createChainable([mockSubscription]);
      mockSubModel.find
        .mockReturnValueOnce(advanceChain)
        .mockReturnValueOnce(chain);
      mockSubModel.countDocuments.mockReturnValueOnce(createChainable(1));

      await service.findAll(userId, {});

      expect(mockSubModel.find).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          userId: expect.any(Types.ObjectId),
        }),
      );
    });

    it('should add category filter when provided', async () => {
      const advanceChain = createChainable([]);
      const chain = createChainable([]);
      mockSubModel.find
        .mockReturnValueOnce(advanceChain)
        .mockReturnValueOnce(chain);
      mockSubModel.countDocuments.mockReturnValueOnce(createChainable(0));

      await service.findAll(userId, { category: 'Streaming' });

      expect(mockSubModel.find).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ category: 'Streaming' }),
      );
    });

    it('should add billingCycle filter when provided', async () => {
      const advanceChain = createChainable([]);
      const chain = createChainable([]);
      mockSubModel.find
        .mockReturnValueOnce(advanceChain)
        .mockReturnValueOnce(chain);
      mockSubModel.countDocuments.mockReturnValueOnce(createChainable(0));

      await service.findAll(userId, { billingCycle: BillingCycle.MONTHLY });

      expect(mockSubModel.find).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ billingCycle: BillingCycle.MONTHLY }),
      );
    });

    it('should filter by tags when provided', async () => {
      const advanceChain = createChainable([]);
      const chain = createChainable([]);
      mockSubModel.find
        .mockReturnValueOnce(advanceChain)
        .mockReturnValueOnce(chain);
      mockSubModel.countDocuments.mockReturnValueOnce(createChainable(0));

      await service.findAll(userId, { tags: 'shared,essential' });

      expect(mockSubModel.find).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ tags: { $in: ['shared', 'essential'] } }),
      );
    });

    it('should filter by weekly billingCycle when provided', async () => {
      const advanceChain = createChainable([]);
      const chain = createChainable([]);
      mockSubModel.find
        .mockReturnValueOnce(advanceChain)
        .mockReturnValueOnce(chain);
      mockSubModel.countDocuments.mockReturnValueOnce(createChainable(0));

      await service.findAll(userId, { billingCycle: BillingCycle.WEEKLY });

      expect(mockSubModel.find).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ billingCycle: BillingCycle.WEEKLY }),
      );
    });

    it('should default to sort by createdAt descending', async () => {
      const advanceChain = createChainable([]);
      const chain = createChainable([]);
      mockSubModel.find
        .mockReturnValueOnce(advanceChain)
        .mockReturnValueOnce(chain);
      mockSubModel.countDocuments.mockReturnValueOnce(createChainable(0));

      await service.findAll(userId, {});

      expect(chain.sort).toHaveBeenCalledWith({ createdAt: -1 });
    });

    it('should sort by normalized monthly cost ascending', async () => {
      const weeklySub = {
        ...mockSubscription,
        name: 'Weekly',
        cost: 10,
        billingCycle: BillingCycle.WEEKLY,
      };
      const monthlySub = {
        ...mockSubscription,
        name: 'Monthly',
        cost: 30,
        billingCycle: BillingCycle.MONTHLY,
      };
      const yearlySub = {
        ...mockSubscription,
        name: 'Yearly',
        cost: 600,
        billingCycle: BillingCycle.YEARLY,
      };

      const advanceChain = createChainable([]);
      const chain = createChainable([monthlySub, weeklySub, yearlySub]);
      mockSubModel.find
        .mockReturnValueOnce(advanceChain)
        .mockReturnValueOnce(chain);
      mockSubModel.countDocuments.mockReturnValueOnce(createChainable(3));

      const result = await service.findAll(userId, {
        sortBy: 'cost',
        sortOrder: 'asc',
      });

      // Monthly costs: monthly=30, weekly=10*4.33=43.30, yearly=600/12=50
      expect(result.data.map((s: any) => s.name)).toEqual([
        'Monthly',
        'Weekly',
        'Yearly',
      ]);
      expect(chain.sort).not.toHaveBeenCalled();
    });

    it('should sort by normalized monthly cost descending', async () => {
      const weeklySub = {
        ...mockSubscription,
        name: 'Weekly',
        cost: 10,
        billingCycle: BillingCycle.WEEKLY,
      };
      const monthlySub = {
        ...mockSubscription,
        name: 'Monthly',
        cost: 30,
        billingCycle: BillingCycle.MONTHLY,
      };
      const yearlySub = {
        ...mockSubscription,
        name: 'Yearly',
        cost: 600,
        billingCycle: BillingCycle.YEARLY,
      };

      const advanceChain = createChainable([]);
      const chain = createChainable([monthlySub, weeklySub, yearlySub]);
      mockSubModel.find
        .mockReturnValueOnce(advanceChain)
        .mockReturnValueOnce(chain);
      mockSubModel.countDocuments.mockReturnValueOnce(createChainable(3));

      const result = await service.findAll(userId, {
        sortBy: 'cost',
        sortOrder: 'desc',
      });

      // Descending: yearly=50, weekly=43.30, monthly=30
      expect(result.data.map((s: any) => s.name)).toEqual([
        'Yearly',
        'Weekly',
        'Monthly',
      ]);
    });

    it('should use MongoDB sort for non-cost fields', async () => {
      const advanceChain = createChainable([]);
      const chain = createChainable([]);
      mockSubModel.find
        .mockReturnValueOnce(advanceChain)
        .mockReturnValueOnce(chain);
      mockSubModel.countDocuments.mockReturnValueOnce(createChainable(0));

      await service.findAll(userId, { sortBy: 'name', sortOrder: 'asc' });

      expect(chain.sort).toHaveBeenCalledWith({ name: 1 });
    });

    it('should advance overdue dates before returning results', async () => {
      const advanceChain = createChainable([]);
      const chain = createChainable([]);
      mockSubModel.find
        .mockReturnValueOnce(advanceChain)
        .mockReturnValueOnce(chain);
      mockSubModel.countDocuments.mockReturnValueOnce(createChainable(0));

      await service.findAll(userId, {});

      // First find call should be the advance query for overdue active subs
      expect(mockSubModel.find).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          isActive: true,
          nextBillingDate: { $lte: expect.any(Date) },
        }),
      );
    });

    it('should skip advanceOverdueDates on second call within cooldown', async () => {
      const advanceChain = createChainable([]);
      const chain1 = createChainable([mockSubscription]);
      const chain2 = createChainable([mockSubscription]);
      mockSubModel.find
        .mockReturnValueOnce(advanceChain)
        .mockReturnValueOnce(chain1)
        .mockReturnValueOnce(chain2);
      mockSubModel.countDocuments
        .mockReturnValueOnce(createChainable(1))
        .mockReturnValueOnce(createChainable(1));

      await service.findAll(userId, {});
      await service.findAll(userId, {});

      // find called 3 times: advance + main query + main query (no advance)
      expect(mockSubModel.find).toHaveBeenCalledTimes(3);
    });

    it('should return paginated envelope with correct meta', async () => {
      const advanceChain = createChainable([]);
      const chain = createChainable([mockSubscription]);
      mockSubModel.find
        .mockReturnValueOnce(advanceChain)
        .mockReturnValueOnce(chain);
      mockSubModel.countDocuments.mockReturnValueOnce(createChainable(1));

      const result = await service.findAll(userId, {});

      expect(result.data).toEqual([mockSubscription]);
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
        hasNextPage: false,
      });
    });

    it('should apply skip and limit for non-cost sort', async () => {
      const advanceChain = createChainable([]);
      const chain = createChainable([]);
      mockSubModel.find
        .mockReturnValueOnce(advanceChain)
        .mockReturnValueOnce(chain);
      mockSubModel.countDocuments.mockReturnValueOnce(createChainable(25));

      const result = await service.findAll(userId, { page: 2, limit: 10 });

      expect(chain.skip).toHaveBeenCalledWith(10);
      expect(chain.limit).toHaveBeenCalledWith(10);
      expect(result.meta).toEqual({
        total: 25,
        page: 2,
        limit: 10,
        totalPages: 3,
        hasNextPage: true,
      });
    });

    it('should compute hasNextPage correctly on last page', async () => {
      const advanceChain = createChainable([]);
      const chain = createChainable([]);
      mockSubModel.find
        .mockReturnValueOnce(advanceChain)
        .mockReturnValueOnce(chain);
      mockSubModel.countDocuments.mockReturnValueOnce(createChainable(25));

      const result = await service.findAll(userId, { page: 3, limit: 10 });

      expect(result.meta.hasNextPage).toBe(false);
    });

    it('should return all results when limit=0', async () => {
      const subs = [mockSubscription, { ...mockSubscription, _id: 'sub2' }];
      const advanceChain = createChainable([]);
      const chain = createChainable(subs);
      mockSubModel.find
        .mockReturnValueOnce(advanceChain)
        .mockReturnValueOnce(chain);
      mockSubModel.countDocuments.mockReturnValueOnce(createChainable(2));

      const result = await service.findAll(userId, { limit: 0 });

      expect(chain.skip).not.toHaveBeenCalled();
      expect(chain.limit).not.toHaveBeenCalled();
      expect(result.data).toHaveLength(2);
      expect(result.meta).toEqual({
        total: 2,
        page: 1,
        limit: 0,
        totalPages: 1,
        hasNextPage: false,
      });
    });

    it('should paginate cost-sorted results', async () => {
      const subs = Array.from({ length: 5 }, (_, i) => ({
        ...mockSubscription,
        _id: `sub${i}`,
        name: `Sub${i}`,
        cost: (i + 1) * 10,
        billingCycle: BillingCycle.MONTHLY,
      }));
      const advanceChain = createChainable([]);
      const chain = createChainable(subs);
      mockSubModel.find
        .mockReturnValueOnce(advanceChain)
        .mockReturnValueOnce(chain);
      mockSubModel.countDocuments.mockReturnValueOnce(createChainable(5));

      const result = await service.findAll(userId, {
        sortBy: 'cost',
        sortOrder: 'asc',
        page: 2,
        limit: 2,
      });

      expect(result.data.map((s: any) => s.name)).toEqual(['Sub2', 'Sub3']);
      expect(result.meta.total).toBe(5);
    });
  });

  describe('findOne', () => {
    it('should return subscription when userId matches', async () => {
      mockSubModel.findById.mockReturnValue(createChainable(mockSubscription));

      const result = await service.findOne(userId, subId);

      expect(mockSubModel.findById).toHaveBeenCalledWith(subId);
      expect(result).toEqual(mockSubscription);
    });

    it('should throw NotFoundException when subscription is not found', async () => {
      mockSubModel.findById.mockReturnValue(createChainable(null));

      await expect(service.findOne(userId, 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException when userId does not match', async () => {
      const otherUserSub = {
        ...mockSubscription,
        userId: new Types.ObjectId('507f1f77bcf86cd799439099'),
      };
      mockSubModel.findById.mockReturnValue(createChainable(otherUserSub));

      await expect(service.findOne(userId, subId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException when subscription has no userId', async () => {
      const noOwnerSub = { ...mockSubscription, userId: null };
      mockSubModel.findById.mockReturnValue(createChainable(noOwnerSub));

      await expect(service.findOne(userId, subId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('should update fields, save, and log', async () => {
      const existingSub = {
        ...mockSubscription,
        save: jest.fn().mockResolvedValue({
          ...mockSubscription,
          name: 'Netflix Premium',
        }),
      };
      mockSubModel.findById.mockReturnValue(createChainable(existingSub));
      const logSpy = jest.spyOn(Logger.prototype, 'log');

      const result = await service.update(userId, subId, {
        name: 'Netflix Premium',
      });

      expect(existingSub.name).toBe('Netflix Premium');
      expect(existingSub.save).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(logSpy).toHaveBeenCalledWith(
        { userId, subscriptionId: subId },
        'Subscription updated',
      );
    });
  });

  describe('remove', () => {
    it('should atomically delete by id and userId and log', async () => {
      mockSubModel.findOneAndDelete.mockReturnValue(
        createChainable(mockSubscription),
      );
      const logSpy = jest.spyOn(Logger.prototype, 'log');

      await service.remove(userId, subId);

      expect(mockSubModel.findOneAndDelete).toHaveBeenCalledWith({
        _id: expect.any(Types.ObjectId),
        userId: expect.any(Types.ObjectId),
      });
      expect(logSpy).toHaveBeenCalledWith(
        { userId, subscriptionId: subId },
        'Subscription deleted',
      );
    });

    it('should throw NotFoundException if subscription not found or not owned', async () => {
      mockSubModel.findOneAndDelete.mockReturnValue(createChainable(null));

      await expect(service.remove(userId, subId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('removeAllByUserId', () => {
    it('should delete all subscriptions for the given userId', async () => {
      mockSubModel.deleteMany.mockReturnValue(
        createChainable({ deletedCount: 3 }),
      );

      const result = await service.removeAllByUserId(userId);

      expect(mockSubModel.deleteMany).toHaveBeenCalledWith({
        userId: expect.any(Types.ObjectId),
      });
      expect(result).toBe(3);
    });

    it('should return 0 when the user has no subscriptions', async () => {
      mockSubModel.deleteMany.mockReturnValue(
        createChainable({ deletedCount: 0 }),
      );

      const result = await service.removeAllByUserId(userId);

      expect(result).toBe(0);
    });
  });

  describe('bulkOperation', () => {
    const subId2 = '507f1f77bcf86cd799439033';

    it('should call deleteMany with correct filter for delete action', async () => {
      const validDoc = { _id: new Types.ObjectId(subId) };
      mockSubModel.find.mockReturnValueOnce(createChainable([validDoc]));
      mockSubModel.deleteMany.mockReturnValueOnce(
        createChainable({ deletedCount: 1 }),
      );

      const result = await service.bulkOperation(userId, {
        ids: [subId],
        action: BulkAction.DELETE,
      });

      expect(mockSubModel.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: { $in: [validDoc._id] },
        }),
      );
      expect(result).toEqual({ success: 1, failed: 0 });
    });

    it('should call updateMany with isActive true for activate action', async () => {
      const validDoc = { _id: new Types.ObjectId(subId) };
      mockSubModel.find.mockReturnValueOnce(createChainable([validDoc]));
      mockSubModel.updateMany.mockReturnValueOnce(
        createChainable({ modifiedCount: 1 }),
      );

      const result = await service.bulkOperation(userId, {
        ids: [subId],
        action: BulkAction.ACTIVATE,
      });

      expect(mockSubModel.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: { $in: [validDoc._id] },
        }),
        { $set: { isActive: true } },
      );
      expect(result).toEqual({ success: 1, failed: 0 });
    });

    it('should call updateMany with isActive false for deactivate action', async () => {
      const validDoc = { _id: new Types.ObjectId(subId) };
      mockSubModel.find.mockReturnValueOnce(createChainable([validDoc]));
      mockSubModel.updateMany.mockReturnValueOnce(
        createChainable({ modifiedCount: 1 }),
      );

      const result = await service.bulkOperation(userId, {
        ids: [subId],
        action: BulkAction.DEACTIVATE,
      });

      expect(mockSubModel.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: { $in: [validDoc._id] },
        }),
        { $set: { isActive: false } },
      );
      expect(result).toEqual({ success: 1, failed: 0 });
    });

    it('should call updateMany with category for changeCategory action', async () => {
      const validDoc = { _id: new Types.ObjectId(subId) };
      mockSubModel.find.mockReturnValueOnce(createChainable([validDoc]));
      mockSubModel.updateMany.mockReturnValueOnce(
        createChainable({ modifiedCount: 1 }),
      );

      const result = await service.bulkOperation(userId, {
        ids: [subId],
        action: BulkAction.CHANGE_CATEGORY,
        category: 'Gaming',
      });

      expect(mockSubModel.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: { $in: [validDoc._id] },
        }),
        { $set: { category: 'Gaming' } },
      );
      expect(result).toEqual({ success: 1, failed: 0 });
    });

    it('should throw BadRequestException for changeCategory without category', async () => {
      const validDoc = { _id: new Types.ObjectId(subId) };
      mockSubModel.find.mockReturnValueOnce(createChainable([validDoc]));

      await expect(
        service.bulkOperation(userId, {
          ids: [subId],
          action: BulkAction.CHANGE_CATEGORY,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should return correct success/failed counts for mixed valid/invalid IDs', async () => {
      const validDoc = { _id: new Types.ObjectId(subId) };
      mockSubModel.find.mockReturnValueOnce(createChainable([validDoc]));
      mockSubModel.deleteMany.mockReturnValueOnce(
        createChainable({ deletedCount: 1 }),
      );

      const result = await service.bulkOperation(userId, {
        ids: [subId, subId2],
        action: BulkAction.DELETE,
      });

      expect(result).toEqual({ success: 1, failed: 1 });
    });

    it('should return early when no valid IDs found', async () => {
      mockSubModel.find.mockReturnValueOnce(createChainable([]));

      const result = await service.bulkOperation(userId, {
        ids: [subId],
        action: BulkAction.DELETE,
      });

      expect(result).toEqual({ success: 0, failed: 1 });
      expect(mockSubModel.deleteMany).not.toHaveBeenCalled();
    });

    it('should filter by userId for user scoping', async () => {
      mockSubModel.find.mockReturnValueOnce(createChainable([]));

      await service.bulkOperation(userId, {
        ids: [subId],
        action: BulkAction.DELETE,
      });

      expect(mockSubModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: expect.any(Types.ObjectId),
        }),
      );
    });
  });

  describe('exportCsv', () => {
    it('should return CSV with header and data rows', async () => {
      const sub = {
        ...mockSubscription,
        nextBillingDate: new Date('2025-06-01'),
        notes: 'My notes',
        tags: ['shared', 'essential'],
      };
      const advanceChain = createChainable([]);
      const chain = createChainable([sub]);
      mockSubModel.find
        .mockReturnValueOnce(advanceChain)
        .mockReturnValueOnce(chain);
      mockSubModel.countDocuments.mockReturnValueOnce(createChainable(1));

      const csv = await service.exportCsv(userId, {});

      const lines = csv.split('\n');
      expect(lines[0]).toBe(
        'Name,Cost,Billing Cycle,Category,Next Billing Date,Status,Notes,Tags',
      );
      expect(lines[1]).toBe(
        'Netflix,15.99,monthly,Streaming,2025-06-01,Active,My notes,shared; essential',
      );
    });

    it('should escape fields with commas and quotes', async () => {
      const sub = {
        ...mockSubscription,
        name: 'Netflix, Premium',
        notes: 'Has "special" chars',
      };
      const advanceChain = createChainable([]);
      const chain = createChainable([sub]);
      mockSubModel.find
        .mockReturnValueOnce(advanceChain)
        .mockReturnValueOnce(chain);
      mockSubModel.countDocuments.mockReturnValueOnce(createChainable(1));

      const csv = await service.exportCsv(userId, {});

      const lines = csv.split('\n');
      expect(lines[1]).toContain('"Netflix, Premium"');
      expect(lines[1]).toContain('"Has ""special"" chars"');
    });

    it('should include tags in CSV export', async () => {
      const sub = {
        ...mockSubscription,
        nextBillingDate: new Date('2025-06-01'),
        notes: '',
        tags: ['work', 'team'],
      };
      const advanceChain = createChainable([]);
      const chain = createChainable([sub]);
      mockSubModel.find
        .mockReturnValueOnce(advanceChain)
        .mockReturnValueOnce(chain);
      mockSubModel.countDocuments.mockReturnValueOnce(createChainable(1));

      const csv = await service.exportCsv(userId, {});

      const lines = csv.split('\n');
      expect(lines[1]).toContain('work; team');
    });

    it('should return header only for empty list', async () => {
      const advanceChain = createChainable([]);
      const chain = createChainable([]);
      mockSubModel.find
        .mockReturnValueOnce(advanceChain)
        .mockReturnValueOnce(chain);
      mockSubModel.countDocuments.mockReturnValueOnce(createChainable(0));

      const csv = await service.exportCsv(userId, {});

      const lines = csv.split('\n');
      expect(lines).toHaveLength(1);
      expect(lines[0]).toBe(
        'Name,Cost,Billing Cycle,Category,Next Billing Date,Status,Notes,Tags',
      );
    });

    it('should pass filter params through with limit=0', async () => {
      const advanceChain = createChainable([]);
      const chain = createChainable([]);
      mockSubModel.find
        .mockReturnValueOnce(advanceChain)
        .mockReturnValueOnce(chain);
      mockSubModel.countDocuments.mockReturnValueOnce(createChainable(0));

      await service.exportCsv(userId, {
        category: 'Streaming',
        sortBy: 'name',
        sortOrder: 'asc',
      });

      expect(mockSubModel.find).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ category: 'Streaming' }),
      );
    });
  });

  describe('getMonthlyCost', () => {
    it('should return cost as-is for monthly billing', () => {
      expect(
        SubscriptionsService['getMonthlyCost'](15, BillingCycle.MONTHLY),
      ).toBe(15);
    });

    it('should multiply by 4.33 for weekly billing', () => {
      expect(
        SubscriptionsService['getMonthlyCost'](10, BillingCycle.WEEKLY),
      ).toBeCloseTo(43.3, 1);
    });

    it('should divide by 12 for yearly billing', () => {
      expect(
        SubscriptionsService['getMonthlyCost'](120, BillingCycle.YEARLY),
      ).toBe(10);
    });
  });

  describe('migrateUnownedSubscriptions', () => {
    it('should update subscriptions without userId', async () => {
      mockSubModel.updateMany.mockReturnValue(
        createChainable({ modifiedCount: 3 }),
      );

      const result = await service.migrateUnownedSubscriptions(userId);

      expect(mockSubModel.updateMany).toHaveBeenCalledWith(
        { userId: { $exists: false } },
        { $set: { userId: expect.any(Types.ObjectId) } },
      );
      expect(result).toBe(3);
    });

    it('should return 0 when no unowned subscriptions exist', async () => {
      mockSubModel.updateMany.mockReturnValue(
        createChainable({ modifiedCount: 0 }),
      );

      const result = await service.migrateUnownedSubscriptions(userId);

      expect(result).toBe(0);
    });
  });
});
