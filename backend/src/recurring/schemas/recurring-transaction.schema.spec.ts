import { model, Types } from 'mongoose';
import {
  RecurringTransaction,
  RecurringTransactionSchema,
} from './recurring-transaction.schema';

// A throwaway model so we can exercise schema validators (validateSync) without
// a live Mongo connection — mirrors the lightweight, DB-free schema specs used
// elsewhere (budget.schema.spec, subscription.schema.spec).
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
  // schema.indexes() → [[keys, options], ...]
  const keyList = RecurringTransactionSchema.indexes().map(([keys]) => keys);

  it('indexes { householdId, nextDate } for household-scoped upcoming lists', () => {
    expect(keyList).toContainEqual({ householdId: 1, nextDate: 1 });
  });

  it('indexes { isActive, nextDate } for the cross-household cron scan', () => {
    // Mirrors { isActive, nextBillingDate } on Subscription: the daily
    // materialization/reminder crons scan active schedules by due date.
    expect(keyList).toContainEqual({ isActive: 1, nextDate: 1 });
  });

  it('drops the redundant standalone householdId index', () => {
    // The compound { householdId, nextDate } has householdId as its prefix, so
    // a single-field householdId index would be redundant write overhead.
    expect(keyList).not.toContainEqual({ householdId: 1 });
  });
});

describe('RecurringTransactionSchema validation', () => {
  it('accepts a minimal well-formed schedule', () => {
    expect(new RecurringModel(valid()).validateSync()).toBeUndefined();
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

  it('accepts a schedule without an account (migrated legacy subscriptions)', () => {
    const doc = new RecurringModel(valid());
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.accountId).toBeUndefined();
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

  it('rejects an unknown cadence', () => {
    expect(
      new RecurringModel({ ...valid(), cadence: 'daily' }).validateSync()
        ?.errors.cadence,
    ).toBeDefined();
  });

  it('rejects non-integer, zero, and negative amountCents', () => {
    for (const amountCents of [19.99, 0, -500]) {
      expect(
        new RecurringModel({ ...valid(), amountCents }).validateSync()?.errors
          .amountCents,
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

  it('bounds reminderDaysBefore to 0..30', () => {
    for (const reminderDaysBefore of [-1, 31]) {
      expect(
        new RecurringModel({ ...valid(), reminderDaysBefore }).validateSync()
          ?.errors.reminderDaysBefore,
      ).toBeDefined();
    }
    expect(
      new RecurringModel({ ...valid(), reminderDaysBefore: 0 }).validateSync(),
    ).toBeUndefined();
  });

  it('rejects sharedWith below 2 (a split needs at least two people)', () => {
    expect(
      new RecurringModel({ ...valid(), sharedWith: 1 }).validateSync()?.errors
        .sharedWith,
    ).toBeDefined();
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
});
