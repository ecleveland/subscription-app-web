vi.mock('../api', () => ({ apiFetch: vi.fn() }));

import { apiFetch } from '../api';
import {
  getBudget,
  bulkSetBudget,
  setCategoryLimit,
  clearCategoryLimit,
  buildBudgetGroups,
  shiftMonth,
  formatMonth,
  type BudgetView,
} from '../budget';
import type { BudgetCategory, CategoryGroup } from '../types';

function group(overrides: Partial<CategoryGroup> = {}): CategoryGroup {
  return {
    _id: 'g1',
    householdId: 'h1',
    name: 'Food',
    sortOrder: 0,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  };
}

function category(overrides: Partial<BudgetCategory> = {}): BudgetCategory {
  return {
    _id: 'c1',
    householdId: 'h1',
    groupId: 'g1',
    name: 'Groceries',
    isIncome: false,
    sortOrder: 0,
    isArchived: false,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  };
}

function view(overrides: Partial<BudgetView> = {}): BudgetView {
  return {
    month: '2026-07',
    categories: [],
    totalPlannedCents: 0,
    totalActualCents: 0,
    incomeCents: 0,
    toBeBudgetedCents: 0,
    ...overrides,
  };
}

describe('budget api wrappers', () => {
  afterEach(() => vi.clearAllMocks());

  it('getBudget calls GET /budgets/:month', async () => {
    await getBudget('2026-07');
    expect(apiFetch).toHaveBeenCalledWith('/budgets/2026-07');
  });

  it('bulkSetBudget PUTs the categories array', async () => {
    await bulkSetBudget('2026-07', [{ categoryId: 'c1', plannedCents: 50000 }]);
    expect(apiFetch).toHaveBeenCalledWith('/budgets/2026-07', {
      method: 'PUT',
      body: JSON.stringify({
        categories: [{ categoryId: 'c1', plannedCents: 50000 }],
      }),
    });
  });

  it('setCategoryLimit delegates to the bulk endpoint with one entry', async () => {
    await setCategoryLimit('2026-07', 'c1', 25000);
    expect(apiFetch).toHaveBeenCalledWith('/budgets/2026-07', {
      method: 'PUT',
      body: JSON.stringify({
        categories: [{ categoryId: 'c1', plannedCents: 25000 }],
      }),
    });
  });

  it('clearCategoryLimit DELETEs the per-category entry', async () => {
    await clearCategoryLimit('2026-07', 'c1');
    expect(apiFetch).toHaveBeenCalledWith('/budgets/2026-07/categories/c1', {
      method: 'DELETE',
    });
  });
});

describe('buildBudgetGroups', () => {
  it('joins view rows with category names, grouped by CategoryGroup', () => {
    const groups = [group()];
    const categories = [category()];
    const v = view({
      categories: [
        {
          categoryId: 'c1',
          plannedCents: 50000,
          actualCents: 12000,
          remainingCents: 38000,
          isIncome: false,
        },
      ],
    });

    const result = buildBudgetGroups(v, categories, groups);

    expect(result).toEqual([
      {
        groupId: 'g1',
        name: 'Food',
        rows: [
          {
            categoryId: 'c1',
            name: 'Groceries',
            isIncome: false,
            isArchived: false,
            plannedCents: 50000,
            actualCents: 12000,
            remainingCents: 38000,
          },
        ],
      },
    ]);
  });

  it('gives active categories absent from the view zeroed rows', () => {
    const result = buildBudgetGroups(view(), [category()], [group()]);

    expect(result[0].rows).toEqual([
      expect.objectContaining({
        categoryId: 'c1',
        plannedCents: 0,
        actualCents: 0,
        remainingCents: 0,
      }),
    ]);
  });

  it('includes archived categories only when they appear in the view', () => {
    const categories = [
      category(),
      category({ _id: 'c2', name: 'Old Hobby', isArchived: true, sortOrder: 1 }),
      category({ _id: 'c3', name: 'Older Hobby', isArchived: true, sortOrder: 2 }),
    ];
    const v = view({
      categories: [
        {
          categoryId: 'c2',
          plannedCents: 0,
          actualCents: 500,
          remainingCents: -500,
          isIncome: false,
        },
      ],
    });

    const rows = buildBudgetGroups(v, categories, [group()])[0].rows;

    expect(rows.map((r) => r.categoryId)).toEqual(['c1', 'c2']);
    expect(rows[1]).toEqual(
      expect.objectContaining({ name: 'Old Hobby', isArchived: true }),
    );
  });

  it('sorts groups and rows by sortOrder with name tie-break', () => {
    const groups = [
      group({ _id: 'g2', name: 'Bills', sortOrder: 1 }),
      group({ _id: 'g1', name: 'Food', sortOrder: 0 }),
    ];
    const categories = [
      category({ _id: 'c2', name: 'Dining Out', sortOrder: 1 }),
      category({ _id: 'c1', name: 'Groceries', sortOrder: 0 }),
      category({ _id: 'c4', name: 'Alpha', groupId: 'g2', sortOrder: 0 }),
      category({ _id: 'c3', name: 'Beta', groupId: 'g2', sortOrder: 0 }),
    ];

    const result = buildBudgetGroups(view(), categories, groups);

    expect(result.map((g) => g.name)).toEqual(['Food', 'Bills']);
    expect(result[0].rows.map((r) => r.name)).toEqual([
      'Groceries',
      'Dining Out',
    ]);
    expect(result[1].rows.map((r) => r.name)).toEqual(['Alpha', 'Beta']);
  });

  it('drops view rows whose category is unknown and omits empty groups', () => {
    const groups = [group(), group({ _id: 'g2', name: 'Empty', sortOrder: 1 })];
    const v = view({
      categories: [
        {
          categoryId: 'ghost',
          plannedCents: 100,
          actualCents: 0,
          remainingCents: 100,
          isIncome: false,
        },
      ],
    });

    const result = buildBudgetGroups(v, [category()], groups);

    expect(result).toHaveLength(1);
    expect(result[0].groupId).toBe('g1');
  });

  it('returns no groups when there are no categories', () => {
    expect(buildBudgetGroups(view(), [], [group()])).toEqual([]);
  });
});

describe('shiftMonth', () => {
  it('moves within a year', () => {
    expect(shiftMonth('2026-07', -1)).toBe('2026-06');
    expect(shiftMonth('2026-07', 1)).toBe('2026-08');
  });

  it('rolls over year boundaries', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
  });

  it('handles multi-year deltas', () => {
    expect(shiftMonth('2026-01', -13)).toBe('2024-12');
    expect(shiftMonth('2025-06', 18)).toBe('2026-12');
  });
});

describe('formatMonth', () => {
  it('renders a human-readable label', () => {
    expect(formatMonth('2026-07')).toBe('July 2026');
    expect(formatMonth('2025-12')).toBe('December 2025');
  });
});
