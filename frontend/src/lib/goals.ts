import { apiFetch } from './api';
import { daysUntil } from './utils';
import type { Goal, GoalType } from './types';

// Mirrors backend/src/goals/dto. All money is integer cents.

export interface CreateGoalBody {
  name: string;
  type: GoalType;
  targetCents: number;
  targetDate?: string;
  categoryId?: string;
}

// currentCents is not patchable; it only moves through contributeToGoal.
// Send null for targetDate or categoryId to clear it.
export interface UpdateGoalBody {
  name?: string;
  type?: GoalType;
  targetCents?: number;
  targetDate?: string | null;
  categoryId?: string | null;
  isArchived?: boolean;
}

export function listGoals(includeArchived = false): Promise<Goal[]> {
  const query = includeArchived ? '?includeArchived=true' : '';
  return apiFetch<Goal[]>(`/goals${query}`);
}

export function createGoal(body: CreateGoalBody): Promise<Goal> {
  return apiFetch<Goal>('/goals', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function updateGoal(id: string, body: UpdateGoalBody): Promise<Goal> {
  return apiFetch<Goal>(`/goals/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

// A negative amount corrects an earlier contribution. The backend rejects 0.
export function contributeToGoal(id: string, amountCents: number): Promise<Goal> {
  return apiFetch<Goal>(`/goals/${id}/contributions`, {
    method: 'POST',
    body: JSON.stringify({ amountCents }),
  });
}

export function deleteGoal(id: string): Promise<void> {
  return apiFetch<void>(`/goals/${id}`, { method: 'DELETE' });
}

/**
 * Percent toward the target, rounded and left uncapped so an overshoot reads
 * as "120%". Callers clamp the bar width themselves. remainingCents goes
 * negative past the target.
 */
export function goalProgress(goal: Goal): {
  percent: number;
  remainingCents: number;
} {
  const percent =
    goal.targetCents > 0
      ? Math.round((goal.currentCents * 100) / goal.targetCents)
      : 0;
  return { percent, remainingCents: goal.targetCents - goal.currentCents };
}

/** Whole UTC days until the target date, negative when overdue, null if unset. */
export function daysUntilTarget(goal: Goal): number | null {
  return goal.targetDate ? daysUntil(goal.targetDate) : null;
}
