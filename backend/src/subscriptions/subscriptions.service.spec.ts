import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { SubscriptionsService } from './subscriptions.service';
import { RecurringTransaction } from '../recurring/schemas/recurring-transaction.schema';
import { CategoriesService } from '../categories/categories.service';
import { BulkAction } from './dto/bulk-operation.dto';

// A chainable Mongoose query mock: every builder method returns `this`, and
// `.exec()` resolves the configured value.
function chain(resolved: unknown) {
  const q: any = {};
  for (const m of ['sort', 'skip', 'limit', 'select', 'find']) {
    q[m] = jest.fn().mockReturnValue(q);
  }
  q.exec = jest.fn().mockResolvedValue(resolved);
  return q;
}

const HH = new Types.ObjectId().toString();
const MEMBER = new Types.ObjectId().toString();
const CAT_STREAMING = new Types.ObjectId();
const CAT_SUBS = new Types.ObjectId();
const CAT_FALLBACK = new Types.ObjectId();

// A recurring doc as returned by the model (the subscription slice).
const recDoc = (overrides: Record<string, any> = {}) => ({
  _id: new Types.ObjectId(),
  householdId: new Types.ObjectId(HH),
  memberId: new Types.ObjectId(MEMBER),
  type: 'expense',
  isSubscription: true,
  amountCents: 1599,
  payee: 'Netflix',
  cadence: 'monthly',
  nextDate: new Date('2026-08-01T00:00:00Z'),
  categoryId: CAT_STREAMING,
  subscriptionCategory: 'Streaming',
  notes: undefined,
  tags: [],
  isActive: true,
  reminderDaysBefore: 3,
  trialEndDate: undefined,
  sharedWith: undefined,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  save: jest.fn().mockImplementation(function (this: any) {
    return Promise.resolve(this);
  }),
  ...overrides,
});

describe('SubscriptionsService (over RecurringTransaction, VEG-469)', () => {
  let service: SubscriptionsService;
  let model: any;
  let savedDocs: Record<string, any>[];

  beforeEach(async () => {
    savedDocs = [];

    // The model is both a constructor (for create) and a static query API.
    model = jest.fn().mockImplementation((doc: Record<string, any>) => {
      const captured: Record<string, any> = {
        ...doc,
        _id: new Types.ObjectId(),
        createdAt: new Date('2026-03-01T00:00:00Z'),
        updatedAt: new Date('2026-03-01T00:00:00Z'),
      };
      captured.save = jest.fn().mockImplementation(() => {
        savedDocs.push(captured);
        return Promise.resolve(captured);
      });
      return captured;
    });
    model.find = jest.fn().mockReturnValue(chain([]));
    model.findById = jest.fn().mockReturnValue(chain(null));
    model.findOneAndDelete = jest.fn().mockReturnValue(chain(recDoc()));
    model.countDocuments = jest.fn().mockReturnValue(chain(0));
    model.deleteMany = jest.fn().mockReturnValue(chain({ deletedCount: 0 }));
    model.updateMany = jest.fn().mockReturnValue(chain({ matchedCount: 0 }));

    const categoriesService = {
      resolveImportCategories: jest.fn().mockResolvedValue({
        byName: new Map<string, Types.ObjectId>([
          ['streaming', CAT_STREAMING],
          ['subscriptions', CAT_SUBS],
        ]),
        fallbackId: CAT_FALLBACK,
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        { provide: getModelToken(RecurringTransaction.name), useValue: model },
        { provide: CategoriesService, useValue: categoriesService },
      ],
    }).compile();

    service = moduleRef.get(SubscriptionsService);
  });

  describe('create', () => {
    it('writes a recurring subscription and returns the legacy view shape', async () => {
      const view = await service.create(HH, MEMBER, {
        name: 'Netflix',
        cost: 15.99,
        billingCycle: 'monthly' as any,
        nextBillingDate: '2026-08-01',
        category: 'Streaming',
      });

      expect(savedDocs).toHaveLength(1);
      const doc = savedDocs[0];
      expect(doc.type).toBe('expense');
      expect(doc.isSubscription).toBe(true);
      expect(doc.amountCents).toBe(1599);
      expect(doc.payee).toBe('Netflix');
      expect(doc.cadence).toBe('monthly');
      expect(doc.subscriptionCategory).toBe('Streaming');
      expect(doc.categoryId).toBe(CAT_STREAMING);

      // The view is dollars / billingCycle / category-string.
      expect(view.cost).toBe(15.99);
      expect(view.billingCycle).toBe('monthly');
      expect(view.category).toBe('Streaming');
      expect(view.name).toBe('Netflix');
    });

    it('maps an unknown category to the seeded Subscriptions category id', async () => {
      await service.create(HH, MEMBER, {
        name: 'X',
        cost: 1,
        billingCycle: 'monthly' as any,
        nextBillingDate: '2026-08-01',
        category: 'Nope',
      });
      expect(savedDocs[0].categoryId).toBe(CAT_SUBS);
      expect(savedDocs[0].subscriptionCategory).toBe('Nope');
    });
  });

  describe('findAll', () => {
    it('hard-scopes every query to the isSubscription slice', async () => {
      model.countDocuments.mockReturnValue(chain(0));
      model.find.mockReturnValue(chain([]));
      await service.findAll(HH, {});
      const filter = model.find.mock.calls[0][0];
      expect(filter.isSubscription).toBe(true);
      expect(filter.householdId).toBeDefined();
    });

    it('translates legacy filters to recurring fields', async () => {
      model.countDocuments.mockReturnValue(chain(0));
      model.find.mockReturnValue(chain([]));
      await service.findAll(HH, {
        category: 'Streaming',
        billingCycle: 'monthly' as any,
        search: 'net',
      });
      const filter = model.find.mock.calls[0][0];
      expect(filter.subscriptionCategory).toBe('Streaming');
      expect(filter.cadence).toBe('monthly');
      expect(filter.$or).toEqual([
        { payee: expect.any(RegExp) },
        { notes: expect.any(RegExp) },
      ]);
    });

    it('returns the paginated {data, meta} envelope with mapped views', async () => {
      model.countDocuments.mockReturnValue(chain(1));
      model.find.mockReturnValue(chain([recDoc({ amountCents: 999 })]));
      const res = await service.findAll(HH, { page: 1, limit: 20 });
      expect(res.meta).toEqual({
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
        hasNextPage: false,
      });
      expect((res.data[0] as any).cost).toBe(9.99);
    });

    it('sorts by normalized monthly cost in memory', async () => {
      const yearly = recDoc({ amountCents: 12000, cadence: 'yearly' }); // $10/mo
      const monthly = recDoc({ amountCents: 500, cadence: 'monthly' }); // $5/mo
      model.countDocuments.mockReturnValue(chain(2));
      model.find.mockReturnValue(chain([yearly, monthly]));

      const res = await service.findAll(HH, {
        sortBy: 'cost',
        sortOrder: 'asc',
      });
      const costs = (res.data as any[]).map((s) => s.cost);
      expect(costs).toEqual([5, 120]); // monthly ($5/mo) before yearly ($10/mo)
    });
  });

  describe('findOne', () => {
    it('404s when the id is not a subscription in this household', async () => {
      model.findById.mockReturnValue(chain(recDoc({ isSubscription: false })));
      await expect(service.findOne(HH, 'x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns the mapped view for a household subscription', async () => {
      model.findById.mockReturnValue(chain(recDoc({ amountCents: 2500 })));
      const view = await service.findOne(HH, 'x');
      expect(view.cost).toBe(25);
    });
  });

  describe('update', () => {
    it('maps cost→cents and category→(string + re-resolved id) then saves', async () => {
      const doc = recDoc();
      model.findById.mockReturnValue(chain(doc));

      await service.update(HH, doc._id.toString(), {
        cost: 20,
        category: 'Streaming',
      } as any);

      expect(doc.amountCents).toBe(2000);
      expect(doc.subscriptionCategory).toBe('Streaming');
      expect(doc.categoryId).toBe(CAT_STREAMING);
      expect(doc.save).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes only within the isSubscription slice', async () => {
      model.findOneAndDelete.mockReturnValue(chain(recDoc()));
      await service.remove(HH, new Types.ObjectId().toString());
      expect(model.findOneAndDelete.mock.calls[0][0].isSubscription).toBe(true);
    });

    it('404s when nothing was deleted', async () => {
      model.findOneAndDelete.mockReturnValue(chain(null));
      await expect(
        service.remove(HH, new Types.ObjectId().toString()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('bulkOperation', () => {
    it('changeCategory sets the verbatim string and re-links the category id', async () => {
      const id = new Types.ObjectId();
      model.find.mockReturnValue(chain([{ _id: id }]));
      model.updateMany.mockReturnValue(chain({ matchedCount: 1 }));

      const res = await service.bulkOperation(HH, {
        ids: [id.toString()],
        action: BulkAction.CHANGE_CATEGORY,
        category: 'Streaming',
      });

      const update = model.updateMany.mock.calls[0][1].$set;
      expect(update.subscriptionCategory).toBe('Streaming');
      expect(update.categoryId).toBe(CAT_STREAMING);
      expect(res).toEqual({ success: 1, failed: 0 });
    });

    it('reports all failed when no ids belong to the household slice', async () => {
      model.find.mockReturnValue(chain([]));
      const res = await service.bulkOperation(HH, {
        ids: [new Types.ObjectId().toString()],
        action: BulkAction.DELETE,
      });
      expect(res).toEqual({ success: 0, failed: 1 });
    });
  });

  describe('exportCsv', () => {
    it('emits the legacy CSV header and dollar costs', async () => {
      model.countDocuments.mockReturnValue(chain(1));
      model.find.mockReturnValue(chain([recDoc({ amountCents: 1599 })]));
      const csv = await service.exportCsv(HH, {});
      const [header, row] = csv.split('\n');
      expect(header).toBe(
        'Name,Cost,Billing Cycle,Category,Next Billing Date,Status,Notes,Tags,Trial End Date,Shared With',
      );
      expect(row).toContain('Netflix');
      expect(row).toContain('15.99');
    });
  });

  describe('removeAllByHouseholdId', () => {
    it('deletes only the household subscription slice', async () => {
      model.deleteMany.mockReturnValue(chain({ deletedCount: 3 }));
      const n = await service.removeAllByHouseholdId(HH);
      expect(model.deleteMany.mock.calls[0][0].isSubscription).toBe(true);
      expect(n).toBe(3);
    });
  });
});
