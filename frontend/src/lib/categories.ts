import { apiFetch } from './api';
import type { BudgetCategory, CategoryGroup } from './types';

export function listCategories(
  includeArchived = false,
): Promise<BudgetCategory[]> {
  const query = includeArchived ? '?includeArchived=true' : '';
  return apiFetch<BudgetCategory[]>(`/categories${query}`);
}

export function createCategory(data: {
  name: string;
  groupId: string;
  isIncome?: boolean;
}): Promise<BudgetCategory> {
  return apiFetch<BudgetCategory>('/categories', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// Rename, move to another group, reorder, or archive/unarchive. The backend
// rejects `isIncome` here — flipping it would reclassify historical actuals.
export function updateCategory(
  id: string,
  data: { name?: string; groupId?: string; sortOrder?: number; isArchived?: boolean },
): Promise<BudgetCategory> {
  return apiFetch<BudgetCategory>(`/categories/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

// Each listed category gets sortOrder = its array index; partial lists are
// fine (send one group at a time). Returns the refreshed full category list,
// archived included.
export function reorderCategories(
  categoryIds: string[],
): Promise<BudgetCategory[]> {
  return apiFetch<BudgetCategory[]>('/categories/reorder', {
    method: 'POST',
    body: JSON.stringify({ categoryIds }),
  });
}

export function listCategoryGroups(): Promise<CategoryGroup[]> {
  return apiFetch<CategoryGroup[]>('/categories/groups');
}

export function createCategoryGroup(data: {
  name: string;
}): Promise<CategoryGroup> {
  return apiFetch<CategoryGroup>('/categories/groups', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// Each listed group gets sortOrder = its array index; partial lists are fine.
// Returns the refreshed group list.
export function reorderCategoryGroups(
  groupIds: string[],
): Promise<CategoryGroup[]> {
  return apiFetch<CategoryGroup[]>('/categories/groups/reorder', {
    method: 'POST',
    body: JSON.stringify({ groupIds }),
  });
}

export function updateCategoryGroup(
  id: string,
  data: { name?: string; sortOrder?: number },
): Promise<CategoryGroup> {
  return apiFetch<CategoryGroup>(`/categories/groups/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}
