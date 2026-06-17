import { apiFetch } from './api';
import type { BudgetCategory } from './types';

export function listCategories(): Promise<BudgetCategory[]> {
  return apiFetch<BudgetCategory[]>('/categories');
}
