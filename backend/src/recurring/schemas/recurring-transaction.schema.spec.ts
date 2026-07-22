import { model, Types } from 'mongoose';
import {
  RecurringCadence,
  RecurringTransaction,
  RecurringTransactionSchema,
} from './recurring-transaction.schema';
import { BillingCycle } from '../../subscriptions/schemas/subscription.schema';

// A throwaway model so we can exercise schema validators (validateSync) without
// a live Mongo connection — mirrors the lightweight, DB-free schema specs used
// elsewhere (budget.schema.spec, password-reset.schema.spec).
const RecurringModel = model<RecurringTransaction>(
  'RecurringTransactionSchemaSpec',
  RecurringTransactionSchema,
);

const valid = () => ({
  householdId: new Types.ObjectId(),
  categoryId: new Types.ObjectId(),
  type: 'expense',
  amountCents: 1999,
  payee: 'Netflix',
  cadence: 'monthly',
  nextDate: new Date('2026-08-01'),
});

describe('RecurringTransactionSchema indexes', () => {
  // JSON.stringify of each key spec keeps key ORDER significant — a compound
  // index's prefix is what makes it useful, and deep-equality matchers like
  // toContainEqual would not catch { nextDate, householdId } swapped.
  const indexKeyJson = RecurringTransactionSchema.indexes().map(([keys]) =>
    JSON.stringify(keys),
  );

  it('indexes { householdId, nextDate } for household-scoped upcoming lists', () => {
    expect(indexKeyJson).toContain('{"householdId":1,"nextDate":1}');
  });

  it('indexes { isActive, nextDate } for the cross-household cron scan', () => {
    // Mirrors { isActive, nextBillingDate } on Subscription: the daily
    // materialization/reminder crons scan active schedules by due date.
    expect(indexKeyJson).toContain('{"isActive":1,"nextDate":1}');
  });

  it('drops the redundant standalone householdId index', () => {
    // The compound { householdId, nextDate } has householdId as its prefix, so
    // a single-field householdId index would be redundant write overhead.
    expect(indexKeyJson).not.toContain('{"householdId":1}');
  });
});

describe('cadenceAnchorDay', () => {
  it('is optional (absent means "use the date own day-of-month")', () => {
    const doc = new RecurringModel(valid());
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.cadenceAnchorDay).toBeUndefined();
  });

  it('accepts the 1..31 bounds', () => {
    for (const day of [1, 15, 31]) {
      const doc = new RecurringModel({ ...valid(), cadenceAnchorDay: day });
      expect(doc.validateSync()).toBeUndefined();
    }
  });

  it('rejects out-of-range and non-integer anchors', () => {
    for (const day of [0, 32, 15.5]) {
      const err = new RecurringModel({
        ...valid(),
        cadenceAnchorDay: day,
      }).validateSync();
      expect(err?.errors.cadenceAnchorDay).toBeDefined();
    }
  });
});

describe('RecurringCadence', () => {
  it('stays value-identical to BillingCycle (the VEG-469 fold-in maps 1:1)', () => {
    expect(Object.values(RecurringCadence)).toEqual(
      Object.values(BillingCycle),
    );
  });
});

describe('RecurringTransactionSchema validation', () => {
  it('accepts a minimal well-formed schedule (no account: migrated legacy subscriptions)', () => {
    const doc = new RecurringModel(valid());
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.accountId).toBeUndefined();
  });

  it('requires householdId, categoryId, type, amountCents, payee, cadence, nextDate', () => {
    const err = new RecurringModel({}).validateSync();
    for (const field of [
      'householdId',
      'categoryId',
      'type',
      'amountCents',
      'payee',
      'cadence',
      'nextDate',
    ]) {
      expect(err?.errors[field]).toBeDefined();
    }
  });

  it('rejects a whitespace-only payee (trims to empty, fails required)', () => {
    expect(
      new RecurringModel({ ...valid(), payee: '   ' }).validateSync()?.errors
        .payee,
    ).toBeDefined();
  });

  it('accepts optional accountId, memberId, notes, endDate, sharedWith', () => {
    const err = new RecurringModel({
      ...valid(),
      accountId: new Types.ObjectId(),
      memberId: new Types.ObjectId(),
      notes: 'family plan',
      endDate: new Date('2027-01-01'),
      sharedWith: 3,
    }).validateSync();
    expect(err).toBeUndefined();
  });

  it('rejects transfer and unknown types (income/expense only)', () => {
    for (const type of ['transfer', 'bill']) {
      expect(
        new RecurringModel({ ...valid(), type }).validateSync()?.errors.type,
      ).toBeDefined();
    }
  });

  it('accepts income schedules (paychecks)', () => {
    expect(
      new RecurringModel({ ...valid(), type: 'income' }).validateSync(),
    ).toBeUndefined();
  });

  it('accepts weekly and yearly cadences', () => {
    for (const cadence of ['weekly', 'yearly']) {
      expect(
        new RecurringModel({ ...valid(), cadence }).validateSync(),
      ).toBeUndefined();
    }
  });

  it('rejects an unknown cadence', () => {
    expect(
      new RecurringModel({ ...valid(), cadence: 'daily' }).validateSync()
        ?.errors.cadence,
    ).toBeDefined();
  });

  it('rejects non-integer, zero, and negative amountCents on a non-subscription', () => {
    for (const amountCents of [19.99, 0, -500]) {
      expect(
        new RecurringModel({ ...valid(), amountCents }).validateSync()?.errors
          .amountCents,
      ).toBeDefined();
    }
  });

  it('accepts the amountCents lower bound (1 cent)', () => {
    expect(
      new RecurringModel({ ...valid(), amountCents: 1 }).validateSync(),
    ).toBeUndefined();
  });

  it('allows amountCents 0 on a subscription (a free/$0 subscription, VEG-469)', () => {
    // Legacy Subscription.cost has min 0; the fold-in must preserve $0 subs
    // (e.g. free trials) rather than clamping them up to 1 cent.
    expect(
      new RecurringModel({
        ...valid(),
        isSubscription: true,
        amountCents: 0,
      }).validateSync(),
    ).toBeUndefined();
  });

  it('still rejects a non-integer or negative amountCents even on a subscription', () => {
    for (const amountCents of [19.99, -1]) {
      expect(
        new RecurringModel({
          ...valid(),
          isSubscription: true,
          amountCents,
        }).validateSync()?.errors.amountCents,
      ).toBeDefined();
    }
  });

  it('defaults tags to [], isActive to true, isSubscription to false, reminderDaysBefore to 3', () => {
    const doc = new RecurringModel(valid());
    expect(doc.tags).toEqual([]);
    expect(doc.isActive).toBe(true);
    expect(doc.isSubscription).toBe(false);
    expect(doc.reminderDaysBefore).toBe(3);
  });

  it('bounds reminderDaysBefore to 0..30 (both boundaries accepted)', () => {
    for (const reminderDaysBefore of [-1, 31]) {
      expect(
        new RecurringModel({ ...valid(), reminderDaysBefore }).validateSync()
          ?.errors.reminderDaysBefore,
      ).toBeDefined();
    }
    for (const reminderDaysBefore of [0, 30]) {
      expect(
        new RecurringModel({ ...valid(), reminderDaysBefore }).validateSync(),
      ).toBeUndefined();
    }
  });

  it('rejects a non-integer or explicit-null reminderDaysBefore (non-DTO write paths)', () => {
    // Mongoose applies defaults only to undefined and skips min/max on null,
    // so without the integer validator a folded-in null (VEG-469) or a
    // fractional day count would persist and break the reminder cron math.
    for (const reminderDaysBefore of [2.5, null]) {
      expect(
        new RecurringModel({ ...valid(), reminderDaysBefore }).validateSync()
          ?.errors.reminderDaysBefore,
      ).toBeDefined();
    }
  });

  it('rejects sharedWith below 2 and non-integer sharedWith; accepts 2', () => {
    for (const sharedWith of [1, 2.5]) {
      expect(
        new RecurringModel({ ...valid(), sharedWith }).validateSync()?.errors
          .sharedWith,
      ).toBeDefined();
    }
    expect(
      new RecurringModel({ ...valid(), sharedWith: 2 }).validateSync(),
    ).toBeUndefined();
  });

  it('accepts an explicit-null sharedWith (the legacy null-to-clear contract)', () => {
    // Subscription deliberately accepts and persists sharedWith: null to
    // clear sharing (DTO ValidateIf skips null; the service queries
    // { $in: [null, undefined] }), so migrated docs and null-to-clear
    // PATCHes must validate.
    expect(
      new RecurringModel({ ...valid(), sharedWith: null }).validateSync(),
    ).toBeUndefined();
  });

  it('rejects an income subscription (a subscription is a recurring expense)', () => {
    expect(
      new RecurringModel({
        ...valid(),
        type: 'income',
        isSubscription: true,
      }).validateSync()?.errors.isSubscription,
    ).toBeDefined();
  });

  it('accepts an expense subscription', () => {
    expect(
      new RecurringModel({ ...valid(), isSubscription: true }).validateSync(),
    ).toBeUndefined();
  });

  it('isSubscription validator passes on non-document paths (update validators cannot see the doc)', () => {
    // Under runValidators `this` is the Query, so a cross-field read of
    // this.type is undefined — the validator must not reject there (it would
    // block every isSubscription: true update on valid expense schedules).
    // The invariant is enforced on the save path; updates use load-and-save
    // (VEG-466).
    const { validators } = RecurringTransactionSchema.path('isSubscription');
    // Select by message, not position — mongoose may reorder/augment the
    // validator list, and pinning the wrong one would let a regression in
    // the Document escape hatch ship while this test stays green.
    const custom = validators.find((v) =>
      String(v.message).includes('isSubscription'),
    )?.validator as unknown as (this: unknown, v: boolean) => boolean;
    expect(custom).toBeDefined();
    expect(custom.call({ notADocument: true }, true)).toBe(true);
  });

  it('trims payee and notes', () => {
    const doc = new RecurringModel({
      ...valid(),
      payee: '  Netflix  ',
      notes: '  shared  ',
    });
    expect(doc.payee).toBe('Netflix');
    expect(doc.notes).toBe('shared');
  });

  it('accepts optional subscription fold-in fields (trialEndDate, subscriptionCategory)', () => {
    const doc = new RecurringModel({
      ...valid(),
      isSubscription: true,
      trialEndDate: new Date('2026-09-01'),
      subscriptionCategory: '  Streaming  ',
    });
    expect(doc.validateSync()).toBeUndefined();
    // The verbatim legacy category string is trimmed but otherwise preserved.
    expect(doc.subscriptionCategory).toBe('Streaming');
    expect(doc.trialEndDate).toEqual(new Date('2026-09-01'));
  });
});
