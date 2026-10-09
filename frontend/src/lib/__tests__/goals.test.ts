vi.mock('../api', () => ({ apiFetch: vi.fn() }));

import { apiFetch } from '../api';
import {
  listGoals,
  createGoal,
  updateGoal,
  contributeToGoal,
  deleteGoal,
  goalProgress,
  daysUntilTarget,
} from '../goals';
import type { Goal } from '../types';

function goal(over: Partial<Goal> = {}): Goal {
  return {
    _id: 'g1',
    householdId: 'h',
    name: 'Emergency fund',
    type: 'savings',
    targetCents: 10000,
    currentCents: 0,
    targetDate: null,
    categoryId: null,
    isArchived: false,
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

describe('goals api wrappers', () => {
  afterEach(() => vi.clearAllMocks());

  it('listGoals calls GET /goals and toggles includeArchived', async () => {
    await listGoals();
    expect(apiFetch).toHaveBeenCalledWith('/goals');
    await listGoals(true);
    expect(apiFetch).toHaveBeenCalledWith('/goals?includeArchived=true');
  });

  it('createGoal POSTs the body', async () => {
    const body = { name: 'Car', type: 'savings' as const, targetCents: 500000 };
    await createGoal(body);
    expect(apiFetch).toHaveBeenCalledWith('/goals', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  });

  it('updateGoal PATCHes the body, including nulls', async () => {
    await updateGoal('g1', { targetDate: null, categoryId: null });
    expect(apiFetch).toHaveBeenCalledWith('/goals/g1', {
      method: 'PATCH',
      body: JSON.stringify({ targetDate: null, categoryId: null }),
    });
  });

  it('contributeToGoal POSTs amountCents to the contributions route', async () => {
    await contributeToGoal('g1', -250);
    expect(apiFetch).toHaveBeenCalledWith('/goals/g1/contributions', {
      method: 'POST',
      body: JSON.stringify({ amountCents: -250 }),
    });
  });

  it('deleteGoal sends DELETE /goals/:id', async () => {
    await deleteGoal('g1');
    expect(apiFetch).toHaveBeenCalledWith('/goals/g1', { method: 'DELETE' });
  });
});

describe('goalProgress', () => {
  it('is 0% with the full target remaining when nothing is saved', () => {
    expect(goalProgress(goal({ currentCents: 0 }))).toEqual({
      percent: 0,
      remainingCents: 10000,
    });
  });

  it('rounds a partial percent', () => {
    expect(goalProgress(goal({ targetCents: 30000, currentCents: 10000 }))).toEqual({
      percent: 33,
      remainingCents: 20000,
    });
  });

  it('is exactly 100% with nothing remaining at the target', () => {
    expect(goalProgress(goal({ currentCents: 10000 }))).toEqual({
      percent: 100,
      remainingCents: 0,
    });
  });

  it('does not cap past the target and goes negative on remaining', () => {
    expect(goalProgress(goal({ currentCents: 12000 }))).toEqual({
      percent: 120,
      remainingCents: -2000,
    });
  });

  it('is 0% when the target is 0', () => {
    expect(goalProgress(goal({ targetCents: 0, currentCents: 500 })).percent).toBe(0);
  });
});

describe('daysUntilTarget', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-08T15:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('is null without a target date', () => {
    expect(daysUntilTarget(goal())).toBeNull();
  });

  it('counts whole days to a date-only target', () => {
    expect(daysUntilTarget(goal({ targetDate: '2026-10-18' }))).toBe(10);
  });

  it('accepts a full ISO timestamp and goes negative when overdue', () => {
    expect(daysUntilTarget(goal({ targetDate: '2026-10-05T00:00:00.000Z' }))).toBe(-3);
  });
});
