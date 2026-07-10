import { apiFetch } from './api';
import type { BudgetCategory, CategoryGroup } from './types';

// Mirrors backend/src/budgets/dto/budget-view.interface.ts. All money is
// integer cents; convert to display strings only at the UI boundary.

export interface BudgetCategoryView {
  categoryId: string;
  plannedCents: number;
  actualCents: number;
  remainingCents: number;
  isIncome: boolean;
}

export interface BudgetView {
  month: string;
  // Union of {categories with a planned limit} ∪ {categories with spend this
  // month} — NOT the full category catalog (see buildBudgetGroups).
  categories: BudgetCategoryView[];
  // Planned/actual totals cover expense categories only; income rolls into
  // incomeCents, and toBeBudgetedCents = incomeCents − totalPlannedCents.
  totalPlannedCents: number;
  totalActualCents: number;
  incomeCents: number;
  toBeBudgetedCents: number;
}

export interface BudgetEntry {
  categoryId: string;
  plannedCents: number;
}

export function getBudget(month: string): Promise<BudgetView> {
  return apiFetch<BudgetView>(`/budgets/${month}`);
}

// Additive upsert of the listed limits; returns the recomputed view.
export function bulkSetBudget(
  month: string,
  categories: BudgetEntry[],
): Promise<BudgetView> {
  return apiFetch<BudgetView>(`/budgets/${month}`, {
    method: 'PUT',
    body: JSON.stringify({ categories }),
  });
}

// Persist a single category's limit. Uses the bulk endpoint rather than
// PUT /budgets/:month/categories/:categoryId because the per-category route
// responds 200 with an empty body (which apiFetch can't parse), while the bulk
// route returns the recomputed BudgetView — saving a refetch.
export function setCategoryLimit(
  month: string,
  categoryId: string,
  plannedCents: number,
): Promise<BudgetView> {
  return bulkSetBudget(month, [{ categoryId, plannedCents }]);
}

// Shift a "YYYY-MM" month by a number of months, handling year rollover with
// pure integer arithmetic (no Date, no timezone drift).
export function shiftMonth(month: string, delta: number): string {
  const [year, mon] = month.split('-').map(Number);
  const total = year * 12 + (mon - 1) + delta;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

// "2026-07" → "July 2026". Pinned to UTC so the label never drifts a month
// from the underlying key.
export function formatMonth(month: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T00:00:00Z`));
}

export interface BudgetRow {
  categoryId: string;
  name: string;
  isIncome: boolean;
  isArchived: boolean;
  plannedCents: number;
  actualCents: number;
  remainingCents: number;
}

export interface BudgetGroupRows {
  groupId: string;
  name: string;
  rows: BudgetRow[];
}

const bySortOrder = <T extends { sortOrder: number; name: string }>(
  a: T,
  b: T,
) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);

/**
 * Join the month's BudgetView (which carries only categoryIds) against the
 * category catalog, grouped for display. Every active category gets a row —
 * zeroed when it has no limit or spend yet, so there's always a row to type a
 * first limit into. Archived categories appear only when the view has data for
 * them (historical spend); view rows for unknown categories are dropped and
 * empty groups omitted.
 */
export function buildBudgetGroups(
  view: BudgetView,
  categories: BudgetCategory[],
  groups: CategoryGroup[],
): BudgetGroupRows[] {
  const viewByCategoryId = new Map(
    view.categories.map((v) => [v.categoryId, v]),
  );

  const rows = categories
    .filter((c) => !c.isArchived || viewByCategoryId.has(c._id))
    .map((c) => {
      const v = viewByCategoryId.get(c._id);
      return {
        groupId: c.groupId,
        sortOrder: c.sortOrder,
        name: c.name,
        row: {
          categoryId: c._id,
          name: c.name,
          isIncome: c.isIncome,
          isArchived: c.isArchived,
          plannedCents: v?.plannedCents ?? 0,
          actualCents: v?.actualCents ?? 0,
          remainingCents: v?.remainingCents ?? 0,
        },
      };
    });

  return [...groups]
    .sort(bySortOrder)
    .map((g) => ({
      groupId: g._id,
      name: g.name,
      rows: rows
        .filter((r) => r.groupId === g._id)
        .sort(bySortOrder)
        .map((r) => r.row),
    }))
    .filter((g) => g.rows.length > 0);
}
