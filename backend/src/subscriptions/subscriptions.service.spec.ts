import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { SubscriptionsService } from './subscriptions.service';
import { Subscription, BillingCycle } from './schemas/subscription.schema';

function createChainable(resolvedValue: any = null) {
  const chain: any = {};
  chain.sort = jest.fn().mockReturnValue(chain);
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
    it('should create a subscription with userId as ObjectId', async () => {
      const dto = {
        name: 'Netflix',
        cost: 15.99,
        billingCycle: BillingCycle.MONTHLY,
        nextBillingDate: '2025-06-01',
        category: 'Streaming',
      };
      const saveMock = jest
        .fn()
        .mockResolvedValue({ _id: 'new-id', ...dto, userId });
      mockSubModel.mockImplementation((data: any) => ({
        ...data,
        save: saveMock,
      }));

      await service.create(userId, dto);

      expect(mockSubModel).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Netflix',
          cost: 15.99,
          userId: expect.any(Types.ObjectId),
        }),
      );
      expect(saveMock).toHaveBeenCalled();
    });
  });

  describe('advanceOverdueDates', () => {
    it('should advance a monthly subscription one month', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2025-07-15T12:00:00Z'));

      const overdueSub = {
        ...mockSubscription,
        nextBillingDate: new Date('2025-07-01'),
        billingCycle: BillingCycle.MONTHLY,
        save: jest.fn().mockResolvedValue(undefined),
      };
      mockSubModel.find.mockReturnValueOnce(createChainable([overdueSub]));

      await service.advanceOverdueDates(userId);

      expect(overdueSub.save).toHaveBeenCalled();
      expect(overdueSub.nextBillingDate.getUTCMonth()).toBe(7); // August
      expect(overdueSub.nextBillingDate.getUTCDate()).toBe(1);

      jest.useRealTimers();
    });

    it('should advance a monthly subscription multiple months when needed', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2025-07-15T12:00:00Z'));

      const overdueSub = {
        ...mockSubscription,
        nextBillingDate: new Date('2025-03-01'),
        billingCycle: BillingCycle.MONTHLY,
        save: jest.fn().mockResolvedValue(undefined),
      };
      mockSubModel.find.mockReturnValueOnce(createChainable([overdueSub]));

      await service.advanceOverdueDates(userId);

      expect(overdueSub.nextBillingDate.getUTCMonth()).toBe(7); // August
      expect(overdueSub.nextBillingDate.getUTCFullYear()).toBe(2025);

      jest.useRealTimers();
    });

    it('should advance a yearly subscription', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2025-07-15T12:00:00Z'));

      const overdueSub = {
        ...mockSubscription,
        nextBillingDate: new Date('2024-06-01'),
        billingCycle: BillingCycle.YEARLY,
        save: jest.fn().mockResolvedValue(undefined),
      };
      mockSubModel.find.mockReturnValueOnce(createChainable([overdueSub]));

      await service.advanceOverdueDates(userId);

      // June 2024 → June 2025 (still <= July 15) → June 2026
      expect(overdueSub.nextBillingDate.getUTCFullYear()).toBe(2026);
      expect(overdueSub.nextBillingDate.getUTCMonth()).toBe(5); // June

      jest.useRealTimers();
    });

    it('should handle month-end edge case (Jan 31 -> Feb 28)', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2025-02-15T12:00:00Z'));

      const overdueSub = {
        ...mockSubscription,
        nextBillingDate: new Date('2025-01-31'),
        billingCycle: BillingCycle.MONTHLY,
        save: jest.fn().mockResolvedValue(undefined),
      };
      mockSubModel.find.mockReturnValueOnce(createChainable([overdueSub]));

      await service.advanceOverdueDates(userId);

      expect(overdueSub.nextBillingDate.getUTCMonth()).toBe(1); // February
      expect(overdueSub.nextBillingDate.getUTCDate()).toBe(28);

      jest.useRealTimers();
    });

    it('should restore original day-of-month when month supports it (Jan 31 -> Feb 28 -> Mar 31)', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2025-03-15T12:00:00Z'));

      const overdueSub = {
        ...mockSubscription,
        nextBillingDate: new Date('2025-01-31'),
        billingCycle: BillingCycle.MONTHLY,
        save: jest.fn().mockResolvedValue(undefined),
      };
      mockSubModel.find.mockReturnValueOnce(createChainable([overdueSub]));

      await service.advanceOverdueDates(userId);

      // Jan 31 → Feb 28 (still <= Mar 15) → Mar 31 (> Mar 15, stop)
      expect(overdueSub.nextBillingDate.getUTCMonth()).toBe(2); // March
      expect(overdueSub.nextBillingDate.getUTCDate()).toBe(31);

      jest.useRealTimers();
    });

    it('should handle leap year edge case (Feb 29 -> Feb 28 next year)', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2025-03-01T12:00:00Z'));

      const overdueSub = {
        ...mockSubscription,
        nextBillingDate: new Date('2024-02-29'),
        billingCycle: BillingCycle.YEARLY,
        save: jest.fn().mockResolvedValue(undefined),
      };
      mockSubModel.find.mockReturnValueOnce(createChainable([overdueSub]));

      await service.advanceOverdueDates(userId);

      // Feb 29, 2024 → Feb 28, 2025 (still <= Mar 1) → Feb 28, 2026
      expect(overdueSub.nextBillingDate.getUTCMonth()).toBe(1); // February
      expect(overdueSub.nextBillingDate.getUTCDate()).toBe(28);
      expect(overdueSub.nextBillingDate.getUTCFullYear()).toBe(2026);

      jest.useRealTimers();
    });

    it('should not save when no overdue subscriptions exist', async () => {
      mockSubModel.find.mockReturnValueOnce(createChainable([]));

      await service.advanceOverdueDates(userId);

      expect(mockSubscription.save).not.toHaveBeenCalled();
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
  });

  describe('findAll', () => {
    // Each test mocks find twice: first call for advanceOverdueDates (returns []),
    // second call for the main query.
    it('should filter by userId', async () => {
      const advanceChain = createChainable([]);
      const chain = createChainable([mockSubscription]);
      mockSubModel.find
        .mockReturnValueOnce(advanceChain)
        .mockReturnValueOnce(chain);

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

      await service.findAll(userId, { billingCycle: BillingCycle.MONTHLY });

      expect(mockSubModel.find).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ billingCycle: BillingCycle.MONTHLY }),
      );
    });

    it('should default to sort by createdAt descending', async () => {
      const advanceChain = createChainable([]);
      const chain = createChainable([]);
      mockSubModel.find
        .mockReturnValueOnce(advanceChain)
        .mockReturnValueOnce(chain);

      await service.findAll(userId, {});

      expect(chain.sort).toHaveBeenCalledWith({ createdAt: -1 });
    });

    it('should respect custom sortBy and sortOrder', async () => {
      const advanceChain = createChainable([]);
      const chain = createChainable([]);
      mockSubModel.find
        .mockReturnValueOnce(advanceChain)
        .mockReturnValueOnce(chain);

      await service.findAll(userId, { sortBy: 'cost', sortOrder: 'asc' });

      expect(chain.sort).toHaveBeenCalledWith({ cost: 1 });
    });

    it('should advance overdue dates before returning results', async () => {
      const advanceChain = createChainable([]);
      const chain = createChainable([]);
      mockSubModel.find
        .mockReturnValueOnce(advanceChain)
        .mockReturnValueOnce(chain);

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
    it('should update fields and save', async () => {
      const existingSub = {
        ...mockSubscription,
        save: jest.fn().mockResolvedValue({
          ...mockSubscription,
          name: 'Netflix Premium',
        }),
      };
      mockSubModel.findById.mockReturnValue(createChainable(existingSub));

      const result = await service.update(userId, subId, {
        name: 'Netflix Premium',
      });

      expect(existingSub.name).toBe('Netflix Premium');
      expect(existingSub.save).toHaveBeenCalled();
      expect(result).toBeDefined();
    });
  });

  describe('remove', () => {
    it('should verify ownership then delete', async () => {
      mockSubModel.findById.mockReturnValue(createChainable(mockSubscription));
      mockSubModel.findByIdAndDelete.mockReturnValue(
        createChainable(mockSubscription),
      );

      await service.remove(userId, subId);

      expect(mockSubModel.findById).toHaveBeenCalledWith(subId);
      expect(mockSubModel.findByIdAndDelete).toHaveBeenCalledWith(subId);
    });

    it('should throw NotFoundException if subscription not found', async () => {
      mockSubModel.findById.mockReturnValue(createChainable(null));

      await expect(service.remove(userId, 'nonexistent')).rejects.toThrow(
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
