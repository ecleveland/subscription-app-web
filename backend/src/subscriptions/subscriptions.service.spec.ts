import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { SubscriptionsService } from './subscriptions.service';
import { RecurringTransaction } from '../recurring/schemas/recurring-transaction.schema';
import { CategoriesService } from '../categories/categories.service';
import { AccountsService } from '../accounts/accounts.service';
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
  let accountsService: { findOne: jest.Mock };

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

    accountsService = {
      findOne: jest
        .fn()
        .mockImplementation((householdId: string, accountId: string) =>
          Promise.resolve({
            _id: new Types.ObjectId(accountId),
            householdId: new Types.ObjectId(householdId),
            isArchived: false,
          }),
        ),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        { provide: getModelToken(RecurringTransaction.name), useValue: model },
        { provide: CategoriesService, useValue: categoriesService },
        { provide: AccountsService, useValue: accountsService },
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

  describe('ledger account (VEG-486)', () => {
    const ACCOUNT = new Types.ObjectId();
    const base = {
      name: 'Netflix',
      cost: 15.99,
      billingCycle: 'monthly' as any,
      nextBillingDate: '2026-08-01',
      category: 'Streaming',
    };
    const FREE_MESSAGE =
      'A free subscription cannot be tracked in an account. Set a cost above $0 or leave the account empty.';

    describe('create', () => {
      it('saves the accountId as an ObjectId and returns it on the view', async () => {
        const view = await service.create(HH, MEMBER, {
          ...base,
          accountId: ACCOUNT.toString(),
        });

        expect(accountsService.findOne).toHaveBeenCalledWith(
          HH,
          ACCOUNT.toString(),
        );
        const saved = savedDocs[0].accountId;
        expect(saved).toBeInstanceOf(Types.ObjectId);
        expect(saved.equals(ACCOUNT)).toBe(true);
        expect(view.accountId?.equals(ACCOUNT)).toBe(true);
      });

      it('rejects an account outside the household with a 400', async () => {
        accountsService.findOne.mockRejectedValueOnce(
          new NotFoundException('nope'),
        );
        await expect(
          service.create(HH, MEMBER, {
            ...base,
            accountId: ACCOUNT.toString(),
          }),
        ).rejects.toThrow(
          new BadRequestException(
            `accountId "${ACCOUNT.toString()}" does not reference an account in this household`,
          ),
        );
        expect(savedDocs).toHaveLength(0);
      });

      it('rejects an archived account with a 400', async () => {
        accountsService.findOne.mockResolvedValueOnce({
          _id: ACCOUNT,
          isArchived: true,
        });
        await expect(
          service.create(HH, MEMBER, {
            ...base,
            accountId: ACCOUNT.toString(),
          }),
        ).rejects.toThrow(
          new BadRequestException(
            'Cannot track a subscription in an archived account',
          ),
        );
        expect(savedDocs).toHaveLength(0);
      });

      it('rejects a free subscription with an account', async () => {
        await expect(
          service.create(HH, MEMBER, {
            ...base,
            cost: 0,
            accountId: ACCOUNT.toString(),
          }),
        ).rejects.toThrow(new BadRequestException(FREE_MESSAGE));
        expect(savedDocs).toHaveLength(0);
      });

      it('leaves accountId unset without an account and views it as null', async () => {
        const view = await service.create(HH, MEMBER, base);
        expect(savedDocs[0].accountId).toBeUndefined();
        expect(view.accountId).toBeNull();
        expect(accountsService.findOne).not.toHaveBeenCalled();
      });

      it('treats an explicit null accountId as no account', async () => {
        const view = await service.create(HH, MEMBER, {
          ...base,
          accountId: null,
        });
        expect(savedDocs[0].accountId).toBeUndefined();
        expect(view.accountId).toBeNull();
      });
    });

    describe('update', () => {
      it('attaches an account to an account-less subscription', async () => {
        const doc = recDoc();
        model.findById.mockReturnValue(chain(doc));

        const view = await service.update(HH, doc._id.toString(), {
          accountId: ACCOUNT.toString(),
        });

        expect(doc.save).toHaveBeenCalled();
        expect((doc as any).accountId.equals(ACCOUNT)).toBe(true);
        expect(view.accountId?.equals(ACCOUNT)).toBe(true);
      });

      it('detaches the account when patched with null', async () => {
        const doc = recDoc({ accountId: ACCOUNT });
        model.findById.mockReturnValue(chain(doc));

        const view = await service.update(HH, doc._id.toString(), {
          accountId: null,
        });

        expect(doc.save).toHaveBeenCalled();
        expect(doc.accountId).toBeUndefined();
        expect(view.accountId).toBeNull();
        expect(accountsService.findOne).not.toHaveBeenCalled();
      });

      it('rejects attaching an account to a free subscription', async () => {
        const doc = recDoc({ amountCents: 0 });
        model.findById.mockReturnValue(chain(doc));

        await expect(
          service.update(HH, doc._id.toString(), {
            accountId: ACCOUNT.toString(),
          }),
        ).rejects.toThrow(new BadRequestException(FREE_MESSAGE));
        expect(doc.save).not.toHaveBeenCalled();
      });

      it('rejects dropping the cost to 0 while an account is attached', async () => {
        const doc = recDoc({ accountId: ACCOUNT });
        model.findById.mockReturnValue(chain(doc));

        await expect(
          service.update(HH, doc._id.toString(), { cost: 0 }),
        ).rejects.toThrow(new BadRequestException(FREE_MESSAGE));
        expect(doc.save).not.toHaveBeenCalled();
        expect(doc.amountCents).toBe(1599);
      });

      it('allows a cost of 0 when the same patch detaches the account', async () => {
        const doc = recDoc({ accountId: ACCOUNT });
        model.findById.mockReturnValue(chain(doc));

        await service.update(HH, doc._id.toString(), {
          cost: 0,
          accountId: null,
        });
        expect(doc.save).toHaveBeenCalled();
        expect(doc.amountCents).toBe(0);
        expect(doc.accountId).toBeUndefined();
      });

      it('rejects reactivating a subscription whose account is archived', async () => {
        const doc = recDoc({ accountId: ACCOUNT, isActive: false });
        model.findById.mockReturnValue(chain(doc));
        accountsService.findOne.mockResolvedValueOnce({
          _id: ACCOUNT,
          isArchived: true,
        });

        await expect(
          service.update(HH, doc._id.toString(), { isActive: true }),
        ).rejects.toThrow(
          new BadRequestException(
            'Cannot reactivate a subscription whose account is archived',
          ),
        );
        expect(doc.save).not.toHaveBeenCalled();
        expect(doc.isActive).toBe(false);
      });

      it('reactivates a subscription whose account is usable', async () => {
        const doc = recDoc({ accountId: ACCOUNT, isActive: false });
        model.findById.mockReturnValue(chain(doc));

        await service.update(HH, doc._id.toString(), { isActive: true });
        expect(accountsService.findOne).toHaveBeenCalledWith(
          HH,
          ACCOUNT.toString(),
        );
        expect(doc.save).toHaveBeenCalled();
        expect(doc.isActive).toBe(true);
      });

      describe('stale nextDate on attach', () => {
        const DAY = 86_400_000;
        const todayUtc = () => {
          const n = new Date();
          return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
        };
        // The 15th, eight months back: every month has a 15th, so a monthly
        // roll keeps the day-of-month exactly.
        const eightMonthsAgo = () => {
          const n = new Date();
          return new Date(
            Date.UTC(n.getUTCFullYear(), n.getUTCMonth() - 8, 15),
          );
        };

        it('rolls a past nextDate forward to today or later when an account is first attached', async () => {
          const doc = recDoc({
            isActive: false,
            nextDate: eightMonthsAgo(),
            cadenceAnchorDay: 15,
          });
          model.findById.mockReturnValue(chain(doc));

          await service.update(HH, doc._id.toString(), {
            isActive: true,
            accountId: ACCOUNT.toString(),
          });

          expect(doc.save).toHaveBeenCalled();
          const next: Date = doc.nextDate;
          expect(next.getTime()).toBeGreaterThanOrEqual(todayUtc());
          // Still on the cadence, and the first occurrence on or after today.
          expect(next.getUTCDate()).toBe(15);
          expect(next.getTime()).toBeLessThan(todayUtc() + 32 * DAY);
        });

        it('rolls forward even when the same patch echoes the stale nextBillingDate', async () => {
          const stale = eightMonthsAgo();
          const doc = recDoc({ nextDate: stale, cadenceAnchorDay: 15 });
          model.findById.mockReturnValue(chain(doc));

          await service.update(HH, doc._id.toString(), {
            nextBillingDate: stale.toISOString().slice(0, 10),
            accountId: ACCOUNT.toString(),
          });

          expect(doc.nextDate.getTime()).toBeGreaterThanOrEqual(todayUtc());
        });

        it('does not roll the date when re-pointing an already-tracked subscription', async () => {
          const stale = eightMonthsAgo();
          const doc = recDoc({ accountId: ACCOUNT, nextDate: stale });
          model.findById.mockReturnValue(chain(doc));

          await service.update(HH, doc._id.toString(), {
            accountId: new Types.ObjectId().toString(),
          });

          expect(doc.nextDate).toEqual(stale);
        });

        it('rolls a past nextDate forward when a tracked subscription is reactivated', async () => {
          const n = new Date();
          const sixMonthsAgo = new Date(
            Date.UTC(n.getUTCFullYear(), n.getUTCMonth() - 6, 15),
          );
          const doc = recDoc({
            accountId: ACCOUNT,
            isActive: false,
            nextDate: sixMonthsAgo,
            cadenceAnchorDay: 15,
          });
          model.findById.mockReturnValue(chain(doc));

          await service.update(HH, doc._id.toString(), { isActive: true });

          expect(doc.save).toHaveBeenCalled();
          expect(doc.nextDate.getTime()).toBeGreaterThanOrEqual(todayUtc());
          expect(doc.nextDate.getUTCDate()).toBe(15);
          expect(doc.nextDate.getTime()).toBeLessThan(todayUtc() + 32 * DAY);
        });

        it('leaves a past nextDate alone on an unrelated edit to an active tracked subscription', async () => {
          const stale = eightMonthsAgo();
          const doc = recDoc({ accountId: ACCOUNT, nextDate: stale });
          model.findById.mockReturnValue(chain(doc));

          await service.update(HH, doc._id.toString(), { name: 'Renamed' });

          expect(doc.save).toHaveBeenCalled();
          expect(doc.nextDate).toEqual(stale);
        });

        it('does not roll the date on create', async () => {
          const stale = eightMonthsAgo();
          await service.create(HH, MEMBER, {
            ...base,
            nextBillingDate: stale.toISOString().slice(0, 10),
            accountId: ACCOUNT.toString(),
          });
          expect(savedDocs[0].nextDate).toEqual(stale);
        });
      });

      it('does not re-check the account when the patch echoes the same id', async () => {
        const doc = recDoc({ accountId: ACCOUNT });
        model.findById.mockReturnValue(chain(doc));

        await service.update(HH, doc._id.toString(), {
          name: 'Renamed',
          accountId: ACCOUNT.toString().toUpperCase(),
        });
        expect(accountsService.findOne).not.toHaveBeenCalled();
        expect(doc.save).toHaveBeenCalled();
      });
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

    it('activate skips subscriptions whose account is archived or missing', async () => {
      const usable = new Types.ObjectId();
      const onArchived = new Types.ObjectId();
      const onMissing = new Types.ObjectId();
      const noAccount = new Types.ObjectId();
      const ARCHIVED_ACC = new Types.ObjectId();
      const MISSING_ACC = new Types.ObjectId();
      const GOOD_ACC = new Types.ObjectId();
      model.find.mockReturnValue(
        chain([
          { _id: usable, accountId: GOOD_ACC },
          { _id: onArchived, accountId: ARCHIVED_ACC },
          { _id: onMissing, accountId: MISSING_ACC },
          { _id: noAccount },
        ]),
      );
      accountsService.findOne.mockImplementation(
        (_hh: string, accountId: string) => {
          if (accountId === MISSING_ACC.toString()) {
            return Promise.reject(new NotFoundException());
          }
          return Promise.resolve({
            _id: new Types.ObjectId(accountId),
            isArchived: accountId === ARCHIVED_ACC.toString(),
          });
        },
      );
      model.updateMany.mockReturnValue(chain({ matchedCount: 2 }));

      const res = await service.bulkOperation(HH, {
        ids: [usable, onArchived, onMissing, noAccount].map(String),
        action: BulkAction.ACTIVATE,
      });

      const filter = model.updateMany.mock.calls[0][0];
      expect(filter._id.$in.map(String).sort()).toEqual(
        [usable, noAccount].map(String).sort(),
      );
      expect(model.updateMany.mock.calls[0][1]).toEqual({
        $set: { isActive: true },
      });
      expect(accountsService.findOne).toHaveBeenCalledTimes(3);
      expect(res).toEqual({ success: 2, failed: 2 });
    });

    it('activate looks up a shared account once and updates nothing when all are blocked', async () => {
      const ARCHIVED_ACC = new Types.ObjectId();
      model.find.mockReturnValue(
        chain([
          { _id: new Types.ObjectId(), accountId: ARCHIVED_ACC },
          { _id: new Types.ObjectId(), accountId: ARCHIVED_ACC },
        ]),
      );
      accountsService.findOne.mockResolvedValue({
        _id: ARCHIVED_ACC,
        isArchived: true,
      });

      const res = await service.bulkOperation(HH, {
        ids: [new Types.ObjectId().toString(), new Types.ObjectId().toString()],
        action: BulkAction.ACTIVATE,
      });

      expect(accountsService.findOne).toHaveBeenCalledTimes(1);
      expect(model.updateMany).not.toHaveBeenCalled();
      expect(res).toEqual({ success: 0, failed: 2 });
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
