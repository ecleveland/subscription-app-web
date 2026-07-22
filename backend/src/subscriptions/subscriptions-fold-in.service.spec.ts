import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import { SubscriptionsFoldInService } from './subscriptions-fold-in.service';
import { Subscription } from './schemas/subscription.schema';
import { RecurringTransaction } from '../recurring/schemas/recurring-transaction.schema';
import { CategoriesService } from '../categories/categories.service';

describe('SubscriptionsFoldInService', () => {
  let service: SubscriptionsFoldInService;
  let subModel: {
    find: jest.Mock;
    updateOne: jest.Mock;
  };
  let recurringModel: jest.Mock;
  let categoriesService: { resolveImportCategories: jest.Mock };

  let savedDocs: Record<string, any>[];
  let saveHandler: (captured: Record<string, any>) => Promise<void>;
  let updateOneExec: jest.Mock;

  const HH = new Types.ObjectId();
  const CAT_STREAMING = new Types.ObjectId();
  const CAT_SUBS = new Types.ObjectId();
  const CAT_FALLBACK = new Types.ObjectId();

  const legacySub = (overrides: Record<string, any> = {}) => ({
    _id: new Types.ObjectId(),
    householdId: HH,
    memberId: new Types.ObjectId(),
    name: 'Netflix',
    cost: 19.99,
    billingCycle: 'monthly',
    nextBillingDate: new Date('2026-08-01T00:00:00Z'),
    category: 'Streaming',
    notes: 'family plan',
    tags: ['media'],
    isActive: true,
    reminderDaysBefore: 5,
    trialEndDate: undefined,
    sharedWith: undefined,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-02-01T00:00:00Z'),
    ...overrides,
  });

  const cursorOver = (docs: any[]) => ({
    lean: () => ({
      cursor: () => ({
        async *[Symbol.asyncIterator]() {
          for (const d of docs) yield await Promise.resolve(d);
        },
      }),
    }),
  });

  const scanReturns = (docs: any[]) =>
    subModel.find.mockReturnValue(cursorOver(docs));

  beforeEach(async () => {
    savedDocs = [];
    saveHandler = (captured) => {
      savedDocs.push(captured);
      return Promise.resolve();
    };
    updateOneExec = jest.fn().mockResolvedValue({ modifiedCount: 1 });

    subModel = {
      find: jest.fn().mockReturnValue(cursorOver([])),
      updateOne: jest.fn().mockReturnValue({ exec: updateOneExec }),
    };

    recurringModel = jest
      .fn()
      .mockImplementation((doc: Record<string, any>) => {
        const captured: Record<string, any> = { ...doc };
        return {
          set: (key: string, value: unknown) => {
            captured[key] = value;
          },
          save: () => saveHandler(captured),
        };
      });

    categoriesService = {
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
        SubscriptionsFoldInService,
        { provide: getModelToken(Subscription.name), useValue: subModel },
        {
          provide: getModelToken(RecurringTransaction.name),
          useValue: recurringModel,
        },
        { provide: CategoriesService, useValue: categoriesService },
      ],
    }).compile();

    service = moduleRef.get(SubscriptionsFoldInService);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  it('folds a subscription into a recurring expense, preserving _id and timestamps', async () => {
    const sub = legacySub();
    scanReturns([sub]);

    const summary = await service.foldInSubscriptions();

    expect(summary).toMatchObject({ scanned: 1, folded: 1, failed: 0 });
    expect(savedDocs).toHaveLength(1);
    const doc = savedDocs[0];
    expect(doc._id).toBe(sub._id);
    expect(doc.householdId).toBe(HH);
    expect(doc.memberId).toBe(sub.memberId);
    expect(doc.type).toBe('expense');
    expect(doc.isSubscription).toBe(true);
    expect(doc.amountCents).toBe(1999);
    expect(doc.payee).toBe('Netflix');
    expect(doc.cadence).toBe('monthly');
    expect(doc.nextDate).toEqual(sub.nextBillingDate);
    expect(doc.categoryId).toBe(CAT_STREAMING);
    expect(doc.subscriptionCategory).toBe('Streaming');
    expect(doc.notes).toBe('family plan');
    expect(doc.tags).toEqual(['media']);
    expect(doc.reminderDaysBefore).toBe(5);
    expect(doc.isActive).toBe(true);
    // No account and no explicit anchor — the scheduler's advance-only path
    // rolls the date; the anchor derives from nextDate.
    expect(doc.accountId).toBeUndefined();
    expect(doc.cadenceAnchorDay).toBeUndefined();
    // Original timestamps preserved so the list default order survives.
    expect(doc.createdAt).toEqual(sub.createdAt);
    expect(doc.updatedAt).toEqual(sub.updatedAt);

    // Source stamped as the idempotency authority.
    expect(subModel.updateOne).toHaveBeenCalledWith(
      { _id: sub._id },
      { $set: { migratedAt: expect.any(Date) } },
    );
  });

  it.each([
    [19.99, 1999],
    [10.1, 1010],
    [0, 0],
    [9.005, 901],
  ])('rounds cost %p dollars to %p cents', async (cost, cents) => {
    scanReturns([legacySub({ cost })]);
    await service.foldInSubscriptions();
    expect(savedDocs[0].amountCents).toBe(cents);
  });

  it('folds a free ($0) subscription (amountCents 0 is valid for subscriptions)', async () => {
    scanReturns([legacySub({ cost: 0 })]);
    const summary = await service.foldInSubscriptions();
    expect(summary.folded).toBe(1);
    expect(savedDocs[0].amountCents).toBe(0);
  });

  it('maps an unknown category name to the seeded "Subscriptions" category', async () => {
    scanReturns([legacySub({ category: 'Totally Unknown' })]);
    await service.foldInSubscriptions();
    expect(savedDocs[0].categoryId).toBe(CAT_SUBS);
    // The verbatim legacy string is still preserved for exact round-trip.
    expect(savedDocs[0].subscriptionCategory).toBe('Totally Unknown');
  });

  it('falls back to the generic fallback when even "Subscriptions" is absent', async () => {
    categoriesService.resolveImportCategories.mockResolvedValue({
      byName: new Map<string, Types.ObjectId>(),
      fallbackId: CAT_FALLBACK,
    });
    scanReturns([legacySub({ category: 'Streaming' })]);
    await service.foldInSubscriptions();
    expect(savedDocs[0].categoryId).toBe(CAT_FALLBACK);
  });

  it('scans only un-stamped subscriptions (idempotent by the source stamp)', async () => {
    await service.foldInSubscriptions();
    expect(subModel.find).toHaveBeenCalledWith({
      migratedAt: { $exists: false },
    });
  });

  it('a re-run with everything migrated folds nothing', async () => {
    scanReturns([]); // stamped docs no longer match the scan filter
    const summary = await service.foldInSubscriptions();
    expect(summary).toMatchObject({ scanned: 0, folded: 0 });
    expect(recurringModel).not.toHaveBeenCalled();
  });

  it('treats a duplicate _id (resumed crash) as already-migrated and still stamps', async () => {
    saveHandler = () => {
      const err = new Error('E11000 duplicate key') as Error & {
        code?: number;
      };
      err.code = 11000;
      return Promise.reject(err);
    };
    const sub = legacySub();
    scanReturns([sub]);

    const summary = await service.foldInSubscriptions();

    expect(summary).toMatchObject({ folded: 0, alreadyMigrated: 1, failed: 0 });
    // The stamp still lands, so the next run skips it.
    expect(subModel.updateOne).toHaveBeenCalledWith(
      { _id: sub._id },
      { $set: { migratedAt: expect.any(Date) } },
    );
  });

  it('skips a subscription with no householdId, leaving it unstamped', async () => {
    scanReturns([legacySub({ householdId: undefined })]);
    const summary = await service.foldInSubscriptions();
    expect(summary).toMatchObject({ skipped: 1, folded: 0 });
    expect(recurringModel).not.toHaveBeenCalled();
    expect(subModel.updateOne).not.toHaveBeenCalled();
  });

  it('isolates a failing doc so the rest of the run still folds', async () => {
    let calls = 0;
    saveHandler = (captured) => {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error('boom'));
      savedDocs.push(captured);
      return Promise.resolve();
    };
    scanReturns([legacySub(), legacySub({ name: 'Spotify' })]);

    const summary = await service.foldInSubscriptions();

    expect(summary).toMatchObject({ scanned: 2, folded: 1, failed: 1 });
    expect(savedDocs).toHaveLength(1);
    expect(savedDocs[0].payee).toBe('Spotify');
  });
});
