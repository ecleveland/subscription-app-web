import { model, Types } from 'mongoose';
import { Budget, BudgetSchema } from './budget.schema';

// A throwaway model so we can exercise schema validators (validateSync) without
// a live Mongo connection — mirrors the lightweight, DB-free schema specs used
// elsewhere (subscription.schema.spec, password-reset.schema.spec).
const BudgetModel = model<Budget>('BudgetSchemaSpec', BudgetSchema);

describe('BudgetSchema indexes', () => {
  // schema.indexes() → [[keys, options], ...]
  const indexes = BudgetSchema.indexes();
  const keyList = indexes.map(([keys]) => keys);

  it('enforces one budget per household per month via a unique compound index', () => {
    const entry = indexes.find(
      ([keys]) => keys.householdId === 1 && keys.month === 1,
    );
    expect(entry).toBeDefined();
    expect(entry?.[1]).toMatchObject({ unique: true });
  });

  it('drops the redundant standalone householdId index', () => {
    // The compound { householdId, month } has householdId as its prefix, so a
    // single-field householdId index would be redundant write overhead.
    expect(keyList).not.toContainEqual({ householdId: 1 });
  });
});

describe('BudgetSchema validation', () => {
  const householdId = new Types.ObjectId();

  it('accepts a well-formed YYYY-MM month', () => {
    const err = new BudgetModel({
      householdId,
      month: '2026-06',
    }).validateSync();
    expect(err).toBeUndefined();
  });

  it('requires householdId and month', () => {
    const err = new BudgetModel({}).validateSync();
    expect(err?.errors.householdId).toBeDefined();
    expect(err?.errors.month).toBeDefined();
  });

  it('rejects a malformed month', () => {
    expect(
      new BudgetModel({ householdId, month: '2026/06' }).validateSync()?.errors
        .month,
    ).toBeDefined();
    expect(
      new BudgetModel({ householdId, month: 'June 2026' }).validateSync()
        ?.errors.month,
    ).toBeDefined();
  });

  it('rejects an out-of-range month number', () => {
    expect(
      new BudgetModel({ householdId, month: '2026-13' }).validateSync()?.errors
        .month,
    ).toBeDefined();
    expect(
      new BudgetModel({ householdId, month: '2026-00' }).validateSync()?.errors
        .month,
    ).toBeDefined();
  });
});
