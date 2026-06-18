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
  chain.lean = jest.fn().mockReturnValue(chain);
  chain.cursor = jest.fn().mockReturnValue({
    async *[Symbol.asyncIterator]() {
      const items = Array.isArray(resolvedValue) ? resolvedValue : [];
      for (const item of items) yield await Promise.resolve(item);
    },
  });
  chain.exec = jest.fn().mockResolvedValue(resolvedValue);
  return chain;
}

describe('SubscriptionsService', () => {
  let service: SubscriptionsService;
  let mockSubModel: any;

  const householdId = '507f1f77bcf86cd799439011';
  const memberId = '507f1f77bcf86cd799439044';
  const subId = '507f1f77bcf86cd799439022';

  const mockSubscription = {
    _id: subId,
    householdId: new Types.ObjectId(householdId),
    memberId: new Types.ObjectId(memberId),
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
    it('should create a subscription stamped with householdId + memberId and log', async () => {
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
        householdId,
        memberId,
      });
      mockSubModel.mockImplementation((data: any) => ({
        ...data,
        save: saveMock,
      }));
      const logSpy = jest.spyOn(Logger.prototype, 'log');

      await service.create(householdId, memberId, dto);

      // Assert the actual id values (not just `expect.any`) so a householdId/
      // memberId transposition — the most error-prone mapping in the PR — is
      // caught at the unit level.
      const built = mockSubModel.mock.calls[0][0];
      expect(built.householdId).toBeInstanceOf(Types.ObjectId);
      expect(built.householdId.equals(new Types.ObjectId(householdId))).toBe(
        true,
      );
      expect(built.memberId).toBeInstanceOf(Types.ObjectId);
      expect(built.memberId.equals(new Types.ObjectId(memberId))).toBe(true);
      expect(built.name).toBe('Netflix');
      expect(saveMock).toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(
        { householdId, memberId, subscriptionId: 'new-id' },
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

      await service.advanceOverdueDates();

      expect(mockSubModel.bulkWrite).toHaveBeenCalledWith(
        [
          {
            updateOne: {
              filter: {
                _id: subId,
                nextBillingDate: { $lte: expect.any(Date) },
              },
              update: { $set: { nextBillingDate: expect.any(Date) } },
            },
          },
        ],
        { ordered: false },
      );
      const newDate =
        mockSubModel.bulkWrite.mock.calls[0][0][0].updateOne.update.$set
          .nextBillingDate;
      expect(newDate.getUTCMonth()).toBe(7); // August
      expect(newDate.getUTCDate()).toBe(1);

      jest.useRealTimers();
    });

    it('flushes bulkWrite in batches of ADVANCE_BATCH_SIZE and sums modified counts', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2025-07-15T12:00:00Z'));

      const overdue = Array.from({ length: 1001 }, (_, i) => ({
        ...mockSubscription,
        _id: `sub${i}`,
        nextBillingDate: new Date('2025-07-01'),
        billingCycle: BillingCycle.MONTHLY,
      }));
      mockSubModel.find.mockReturnValueOnce(createChainable(overdue));
      mockSubModel.bulkWrite
        .mockResolvedValueOnce({ modifiedCount: 500 })
        .mockResolvedValueOnce({ modifiedCount: 500 })
        .mockResolvedValueOnce({ modifiedCount: 1 });

      const advanced = await service.advanceOverdueDates();

      // 1001 ops → batches of 500, 500, 1
      expect(mockSubModel.bulkWrite).toHaveBeenCalledTimes(3);
      expect(mockSubModel.bulkWrite.mock.calls[0][0]).toHaveLength(500);
      expect(mockSubModel.bulkWrite.mock.calls[1][0]).toHaveLength(500);
      expect(mockSubModel.bulkWrite.mock.calls[2][0]).toHaveLength(1);
      // modifiedCount summed across every flushed batch
      expect(advanced).toBe(1001);

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

      await service.advanceOverdueDates();

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

      await service.advanceOverdueDates();

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

      await service.advanceOverdueDates();

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

      await service.advanceOverdueDates();

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

      await service.advanceOverdueDates();

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

      await service.advanceOverdueDates();

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

      await service.advanceOverdueDates();

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

      await service.advanceOverdueDates();

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

      await service.advanceOverdueDates();

      expect(mockSubModel.bulkWrite).not.toHaveBeenCalled();
    });

    it('should only query active subscriptions with past billing dates', async () => {
      mockSubModel.find.mockReturnValueOnce(createChainable([]));

      await service.advanceOverdueDates();

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

      await service.advanceOverdueDates();

      const filter =
        mockSubModel.bulkWrite.mock.calls[0][0][0].updateOne.filter;
      expect(filter._id).toBe(subId);
      expect(filter.nextBillingDate).toEqual({ $lte: expect.any(Date) });

      jest.useRealTimers();
    });
  });

  describe('findAll', () => {
    it('should filter by householdId', async () => {
      const chain = createChainable([mockSubscription]);
      mockSubModel.find.mockReturnValueOnce(chain);
      mockSubModel.countDocuments.mockReturnValueOnce(createChainable(1));

      await service.findAll(householdId, {});

      expect(mockSubModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          householdId: expect.any(Types.ObjectId),
        }),
      );
    });

    it('should add category filter when provided', async () => {
      const chain = createChainable([]);
      mockSubModel.find.mockReturnValueOnce(chain);
      mockSubModel.countDocuments.mockReturnValueOnce(createChainable(0));

      await service.findAll(householdId, { category: 'Streaming' });

      expect(mockSubModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'Streaming' }),
      );
    });

    it('should add billingCycle filter when provided', async () => {
      const chain = createChainable([]);
      mockSubModel.find.mockReturnValueOnce(chain);
      mockSubModel.countDocuments.mockReturnValueOnce(createChainable(0));

      await service.findAll(householdId, {
        billingCycle: BillingCycle.MONTHLY,
      });

      expect(mockSubModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ billingCycle: BillingCycle.MONTHLY }),
      );
    });

    it('should filter by tags when provided', async () => {
      const chain = createChainable([]);
      mockSubModel.find.mockReturnValueOnce(chain);
      mockSubModel.countDocuments.mockReturnValueOnce(createChainable(0));

      await service.findAll(householdId, { tags: 'shared,essential' });

      expect(mockSubModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ tags: { $in: ['shared', 'essential'] } }),
      );
    });

    it('should add a case-insensitive $or search over name and notes when provided', async () => {
      const chain = createChainable([]);
      mockSubModel.find.mockReturnValueOnce(chain);
      mockSubModel.countDocuments.mockReturnValueOnce(createChainable(0));

      await service.findAll(householdId, { search: 'Netflix' });

      const filter = mockSubModel.find.mock.calls[0][0];
      expect(filter.$or).toHaveLength(2);
      expect(filter.$or[0].name).toBeInstanceOf(RegExp);
      expect(filter.$or[0].name.source).toBe('Netflix');
      expect(filter.$or[0].name.flags).toContain('i');
      expect(filter.$or[1].notes).toBeInstanceOf(RegExp);
    });

    it('should escape regex metacharacters in the search term', async () => {
      const chain = createChainable([]);
      mockSubModel.find.mockReturnValueOnce(chain);
      mockSubModel.countDocuments.mockReturnValueOnce(createChainable(0));

      await service.findAll(householdId, { search: 'a.b*c+' });

      const filter = mockSubModel.find.mock.calls[0][0];
      // Metacharacters are escaped so they match literally (no ReDoS/injection)
      expect(filter.$or[0].name.source).toBe('a\\.b\\*c\\+');
    });

    it('should not add a search filter for a blank/whitespace term', async () => {
      const chain = createChainable([]);
      mockSubModel.find.mockReturnValueOnce(chain);
      mockSubModel.countDocuments.mockReturnValueOnce(createChainable(0));

      await service.findAll(householdId, { search: '   ' });

      const filter = mockSubModel.find.mock.calls[0][0];
      expect(filter.$or).toBeUndefined();
    });

    it('should filter shared subscriptions when shared=shared', async () => {
      const chain = createChainable([]);
      mockSubModel.find.mockReturnValueOnce(chain);
      mockSubModel.countDocuments.mockReturnValueOnce(createChainable(0));

      await service.findAll(householdId, { shared: 'shared' });

      expect(mockSubModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ sharedWith: { $gte: 2 } }),
      );
    });

    it('should filter individual subscriptions when shared=individual', async () => {
      const chain = createChainable([]);
      mockSubModel.find.mockReturnValueOnce(chain);
      mockSubModel.countDocuments.mockReturnValueOnce(createChainable(0));

      await service.findAll(householdId, { shared: 'individual' });

      expect(mockSubModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ sharedWith: { $in: [null, undefined] } }),
      );
    });

    it('should filter by weekly billingCycle when provided', async () => {
      const chain = createChainable([]);
      mockSubModel.find.mockReturnValueOnce(chain);
      mockSubModel.countDocuments.mockReturnValueOnce(createChainable(0));

      await service.findAll(householdId, { billingCycle: BillingCycle.WEEKLY });

      expect(mockSubModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ billingCycle: BillingCycle.WEEKLY }),
      );
    });

    it('should default to sort by createdAt descending', async () => {
      const chain = createChainable([]);
      mockSubModel.find.mockReturnValueOnce(chain);
      mockSubModel.countDocuments.mockReturnValueOnce(createChainable(0));

      await service.findAll(householdId, {});

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

      const chain = createChainable([monthlySub, weeklySub, yearlySub]);
      mockSubModel.find.mockReturnValueOnce(chain);
      mockSubModel.countDocuments.mockReturnValueOnce(createChainable(3));

      const result = await service.findAll(householdId, {
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

      const chain = createChainable([monthlySub, weeklySub, yearlySub]);
      mockSubModel.find.mockReturnValueOnce(chain);
      mockSubModel.countDocuments.mockReturnValueOnce(createChainable(3));

      const result = await service.findAll(householdId, {
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
      const chain = createChainable([]);
      mockSubModel.find.mockReturnValueOnce(chain);
      mockSubModel.countDocuments.mockReturnValueOnce(createChainable(0));

      await service.findAll(householdId, { sortBy: 'name', sortOrder: 'asc' });

      expect(chain.sort).toHaveBeenCalledWith({ name: 1 });
    });

    it('should not advance overdue dates from the read path', async () => {
      const chain = createChainable([]);
      mockSubModel.find.mockReturnValueOnce(chain);
      mockSubModel.countDocuments.mockReturnValueOnce(createChainable(0));

      await service.findAll(householdId, {});

      // findAll must query exactly once (the household's list) and never write.
      expect(mockSubModel.find).toHaveBeenCalledTimes(1);
      expect(mockSubModel.bulkWrite).not.toHaveBeenCalled();
    });

    it('should return paginated envelope with correct meta', async () => {
      const chain = createChainable([mockSubscription]);
      mockSubModel.find.mockReturnValueOnce(chain);
      mockSubModel.countDocuments.mockReturnValueOnce(createChainable(1));

      const result = await service.findAll(householdId, {});

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
      const chain = createChainable([]);
      mockSubModel.find.mockReturnValueOnce(chain);
      mockSubModel.countDocuments.mockReturnValueOnce(createChainable(25));

      const result = await service.findAll(householdId, { page: 2, limit: 10 });

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
      const chain = createChainable([]);
      mockSubModel.find.mockReturnValueOnce(chain);
      mockSubModel.countDocuments.mockReturnValueOnce(createChainable(25));

      const result = await service.findAll(householdId, { page: 3, limit: 10 });

      expect(result.meta.hasNextPage).toBe(false);
    });

    it('should return all results when limit=0', async () => {
      const subs = [mockSubscription, { ...mockSubscription, _id: 'sub2' }];
      const chain = createChainable(subs);
      mockSubModel.find.mockReturnValueOnce(chain);
      mockSubModel.countDocuments.mockReturnValueOnce(createChainable(2));

      const result = await service.findAll(householdId, { limit: 0 });

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
      const chain = createChainable(subs);
      mockSubModel.find.mockReturnValueOnce(chain);
      mockSubModel.countDocuments.mockReturnValueOnce(createChainable(5));

      const result = await service.findAll(householdId, {
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
    it('should return subscription when householdId matches', async () => {
      mockSubModel.findById.mockReturnValue(createChainable(mockSubscription));

      const result = await service.findOne(householdId, subId);

      expect(mockSubModel.findById).toHaveBeenCalledWith(subId);
      expect(result).toEqual(mockSubscription);
    });

    it('should throw NotFoundException when subscription is not found', async () => {
      mockSubModel.findById.mockReturnValue(createChainable(null));

      await expect(service.findOne(householdId, 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException when householdId does not match', async () => {
      const otherHouseholdSub = {
        ...mockSubscription,
        householdId: new Types.ObjectId('507f1f77bcf86cd799439099'),
      };
      mockSubModel.findById.mockReturnValue(createChainable(otherHouseholdSub));

      await expect(service.findOne(householdId, subId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException when subscription has no householdId', async () => {
      const noScopeSub = { ...mockSubscription, householdId: null };
      mockSubModel.findById.mockReturnValue(createChainable(noScopeSub));

      await expect(service.findOne(householdId, subId)).rejects.toThrow(
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

      const result = await service.update(householdId, subId, {
        name: 'Netflix Premium',
      });

      expect(existingSub.name).toBe('Netflix Premium');
      expect(existingSub.save).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(logSpy).toHaveBeenCalledWith(
        { householdId, subscriptionId: subId },
        'Subscription updated',
      );
    });
  });

  describe('remove', () => {
    it('should atomically delete by id and householdId and log', async () => {
      mockSubModel.findOneAndDelete.mockReturnValue(
        createChainable(mockSubscription),
      );
      const logSpy = jest.spyOn(Logger.prototype, 'log');

      await service.remove(householdId, subId);

      expect(mockSubModel.findOneAndDelete).toHaveBeenCalledWith({
        _id: expect.any(Types.ObjectId),
        householdId: expect.any(Types.ObjectId),
      });
      expect(logSpy).toHaveBeenCalledWith(
        { householdId, subscriptionId: subId },
        'Subscription deleted',
      );
    });

    it('should throw NotFoundException if subscription not found or not in household', async () => {
      mockSubModel.findOneAndDelete.mockReturnValue(createChainable(null));

      await expect(service.remove(householdId, subId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('removeAllByHouseholdId', () => {
    it('should delete all subscriptions for the given householdId', async () => {
      mockSubModel.deleteMany.mockReturnValue(
        createChainable({ deletedCount: 3 }),
      );

      const result = await service.removeAllByHouseholdId(householdId);

      const filter = mockSubModel.deleteMany.mock.calls[0][0];
      expect(filter.householdId.equals(new Types.ObjectId(householdId))).toBe(
        true,
      );
      expect(result).toBe(3);
    });

    it('should return 0 when the household has no subscriptions', async () => {
      mockSubModel.deleteMany.mockReturnValue(
        createChainable({ deletedCount: 0 }),
      );

      const result = await service.removeAllByHouseholdId(householdId);

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

      const result = await service.bulkOperation(householdId, {
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
        createChainable({ matchedCount: 1, modifiedCount: 1 }),
      );

      const result = await service.bulkOperation(householdId, {
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
        createChainable({ matchedCount: 1, modifiedCount: 1 }),
      );

      const result = await service.bulkOperation(householdId, {
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
        createChainable({ matchedCount: 1, modifiedCount: 1 }),
      );

      const result = await service.bulkOperation(householdId, {
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
        service.bulkOperation(householdId, {
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

      const result = await service.bulkOperation(householdId, {
        ids: [subId, subId2],
        action: BulkAction.DELETE,
      });

      expect(result).toEqual({ success: 1, failed: 1 });
    });

    it('should return early when no valid IDs found', async () => {
      mockSubModel.find.mockReturnValueOnce(createChainable([]));

      const result = await service.bulkOperation(householdId, {
        ids: [subId],
        action: BulkAction.DELETE,
      });

      expect(result).toEqual({ success: 0, failed: 1 });
      expect(mockSubModel.deleteMany).not.toHaveBeenCalled();
    });

    it('reports matchedCount (not modifiedCount) so no-op updates still count', async () => {
      const validDoc = { _id: new Types.ObjectId(subId) };
      mockSubModel.find.mockReturnValueOnce(createChainable([validDoc]));
      // Already active → Mongo matches the doc but modifies nothing.
      mockSubModel.updateMany.mockReturnValueOnce(
        createChainable({ matchedCount: 1, modifiedCount: 0 }),
      );

      const result = await service.bulkOperation(householdId, {
        ids: [subId],
        action: BulkAction.ACTIVATE,
      });

      expect(result).toEqual({ success: 1, failed: 0 });
    });

    it('reports the real deletedCount when a concurrent delete already removed some', async () => {
      const validDoc = { _id: new Types.ObjectId(subId) };
      const validDoc2 = { _id: new Types.ObjectId(subId2) };
      mockSubModel.find.mockReturnValueOnce(
        createChainable([validDoc, validDoc2]),
      );
      // Both matched the pre-write read, but only one was actually deleted.
      mockSubModel.deleteMany.mockReturnValueOnce(
        createChainable({ deletedCount: 1 }),
      );

      const result = await service.bulkOperation(householdId, {
        ids: [subId, subId2],
        action: BulkAction.DELETE,
      });

      expect(result).toEqual({ success: 1, failed: 1 });
    });

    it('should filter by householdId for household scoping', async () => {
      mockSubModel.find.mockReturnValueOnce(createChainable([]));

      await service.bulkOperation(householdId, {
        ids: [subId],
        action: BulkAction.DELETE,
      });

      expect(mockSubModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          householdId: expect.any(Types.ObjectId),
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
      const chain = createChainable([sub]);
      mockSubModel.find.mockReturnValueOnce(chain);
      mockSubModel.countDocuments.mockReturnValueOnce(createChainable(1));

      const csv = await service.exportCsv(householdId, {});

      const lines = csv.split('\n');
      expect(lines[0]).toBe(
        'Name,Cost,Billing Cycle,Category,Next Billing Date,Status,Notes,Tags,Trial End Date,Shared With',
      );
      expect(lines[1]).toBe(
        'Netflix,15.99,monthly,Streaming,2025-06-01,Active,My notes,shared; essential,,',
      );
    });

    it('should escape fields with commas and quotes', async () => {
      const sub = {
        ...mockSubscription,
        name: 'Netflix, Premium',
        notes: 'Has "special" chars',
      };
      const chain = createChainable([sub]);
      mockSubModel.find.mockReturnValueOnce(chain);
      mockSubModel.countDocuments.mockReturnValueOnce(createChainable(1));

      const csv = await service.exportCsv(householdId, {});

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
      const chain = createChainable([sub]);
      mockSubModel.find.mockReturnValueOnce(chain);
      mockSubModel.countDocuments.mockReturnValueOnce(createChainable(1));

      const csv = await service.exportCsv(householdId, {});

      const lines = csv.split('\n');
      expect(lines[1]).toContain('work; team');
    });

    it('should include trialEndDate in CSV when set', async () => {
      const sub = {
        ...mockSubscription,
        nextBillingDate: new Date('2025-06-01'),
        notes: '',
        tags: [],
        trialEndDate: new Date('2025-07-15'),
      };
      const chain = createChainable([sub]);
      mockSubModel.find.mockReturnValueOnce(chain);
      mockSubModel.countDocuments.mockReturnValueOnce(createChainable(1));

      const csv = await service.exportCsv(householdId, {});

      const lines = csv.split('\n');
      expect(lines[1]).toContain(',2025-07-15');
    });

    it('should include sharedWith value in CSV when set', async () => {
      const sub = {
        ...mockSubscription,
        nextBillingDate: new Date('2025-06-01'),
        notes: '',
        tags: [],
        sharedWith: 3,
      };
      const chain = createChainable([sub]);
      mockSubModel.find.mockReturnValueOnce(chain);
      mockSubModel.countDocuments.mockReturnValueOnce(createChainable(1));

      const csv = await service.exportCsv(householdId, {});

      const lines = csv.split('\n');
      const fields = lines[1].split(',');
      expect(fields[fields.length - 1]).toBe('3');
    });

    it('should have empty trialEndDate field when unset', async () => {
      const sub = {
        ...mockSubscription,
        nextBillingDate: new Date('2025-06-01'),
        notes: '',
        tags: [],
      };
      const chain = createChainable([sub]);
      mockSubModel.find.mockReturnValueOnce(chain);
      mockSubModel.countDocuments.mockReturnValueOnce(createChainable(1));

      const csv = await service.exportCsv(householdId, {});

      const lines = csv.split('\n');
      // Last field should be empty (trailing comma produces empty string)
      const fields = lines[1].split(',');
      expect(fields[fields.length - 1]).toBe('');
    });

    it('should return header only for empty list', async () => {
      const chain = createChainable([]);
      mockSubModel.find.mockReturnValueOnce(chain);
      mockSubModel.countDocuments.mockReturnValueOnce(createChainable(0));

      const csv = await service.exportCsv(householdId, {});

      const lines = csv.split('\n');
      expect(lines).toHaveLength(1);
      expect(lines[0]).toBe(
        'Name,Cost,Billing Cycle,Category,Next Billing Date,Status,Notes,Tags,Trial End Date,Shared With',
      );
    });

    it('should pass filter params through with limit=0', async () => {
      const chain = createChainable([]);
      mockSubModel.find.mockReturnValueOnce(chain);
      mockSubModel.countDocuments.mockReturnValueOnce(createChainable(0));

      await service.exportCsv(householdId, {
        category: 'Streaming',
        sortBy: 'name',
        sortOrder: 'asc',
      });

      expect(mockSubModel.find).toHaveBeenCalledWith(
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
});
