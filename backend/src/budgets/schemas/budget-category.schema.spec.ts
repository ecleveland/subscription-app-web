import { model, Types } from 'mongoose';
import { BudgetCategory, BudgetCategorySchema } from './budget-category.schema';

const BudgetCategoryModel = model<BudgetCategory>(
  'BudgetCategorySchemaSpec',
  BudgetCategorySchema,
);

describe('BudgetCategorySchema indexes', () => {
  const indexes = BudgetCategorySchema.indexes();
  const keyList = indexes.map(([keys]) => keys);

  it('enforces one planned amount per (budget, category) via a unique compound index', () => {
    const entry = indexes.find(
      ([keys]) => keys.budgetId === 1 && keys.categoryId === 1,
    );
    expect(entry).toBeDefined();
    expect(entry?.[1]).toMatchObject({ unique: true });
  });

  it('drops the redundant standalone budgetId index', () => {
    // The compound { budgetId, categoryId } has budgetId as its prefix.
    expect(keyList).not.toContainEqual({ budgetId: 1 });
  });
});

describe('BudgetCategorySchema validation', () => {
  const budgetId = new Types.ObjectId();
  const categoryId = new Types.ObjectId();

  it('accepts a non-negative integer plannedCents', () => {
    const err = new BudgetCategoryModel({
      budgetId,
      categoryId,
      plannedCents: 50000,
    }).validateSync();
    expect(err).toBeUndefined();
  });

  it('requires budgetId, categoryId and plannedCents', () => {
    const err = new BudgetCategoryModel({}).validateSync();
    expect(err?.errors.budgetId).toBeDefined();
    expect(err?.errors.categoryId).toBeDefined();
    expect(err?.errors.plannedCents).toBeDefined();
  });

  it('rejects a fractional plannedCents (money is integer minor units)', () => {
    const err = new BudgetCategoryModel({
      budgetId,
      categoryId,
      plannedCents: 12.5,
    }).validateSync();
    expect(err?.errors.plannedCents).toBeDefined();
  });

  it('rejects a negative plannedCents', () => {
    const err = new BudgetCategoryModel({
      budgetId,
      categoryId,
      plannedCents: -100,
    }).validateSync();
    expect(err?.errors.plannedCents).toBeDefined();
  });
});
