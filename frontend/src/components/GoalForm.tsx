'use client';

import { useState, type FormEvent } from 'react';
import {
  createGoal,
  updateGoal,
  type CreateGoalBody,
  type UpdateGoalBody,
} from '@/lib/goals';
import { dollarsToCents } from '@/lib/utils';
import { showErrorToast, showSuccessToast } from '@/lib/toast';
import type { BudgetCategory, Goal, GoalType } from '@/lib/types';

interface Props {
  goal?: Goal;
  categories: BudgetCategory[];
  // True when the categories fetch failed, so the empty picker is explained.
  categoriesUnavailable?: boolean;
  onSaved: (goal: Goal) => void;
  onCancel: () => void;
}

const inputClass =
  'w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700';

export default function GoalForm({
  goal,
  categories,
  categoriesUnavailable = false,
  onSaved,
  onCancel,
}: Props) {
  const isEditing = !!goal;
  // The date input wants YYYY-MM-DD; the API may echo a full ISO timestamp.
  const initialDate = goal?.targetDate ? goal.targetDate.slice(0, 10) : '';
  const initialCategory = goal?.categoryId ?? '';

  const [name, setName] = useState(goal?.name ?? '');
  const [type, setType] = useState<GoalType>(goal?.type ?? 'savings');
  const [target, setTarget] = useState(goal ? String(goal.targetCents / 100) : '');
  const [targetDate, setTargetDate] = useState(initialDate);
  const [categoryId, setCategoryId] = useState(initialCategory);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Archived categories stay hidden unless this goal already points at one.
  const categoryOptions = categories.filter(
    (c) => !c.isArchived || c._id === initialCategory,
  );
  // A deleted category, or a failed categories fetch, leaves the stored id with
  // no option. Without a placeholder the select would show "None" while state
  // holds the id, and picking "None" would never fire onChange.
  const currentCategoryMissing =
    !!initialCategory && !categories.some((c) => c._id === initialCategory);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    const targetCents = dollarsToCents(target);
    if (targetCents === null && target.trim() !== '') {
      setError('Target must be a dollar amount with at most 2 decimals');
      return;
    }
    if (targetCents === null || targetCents <= 0) {
      setError('Target must be greater than $0');
      return;
    }

    setLoading(true);
    try {
      let saved: Goal;
      if (isEditing) {
        const body: UpdateGoalBody = {};
        if (name !== goal.name) body.name = name;
        if (type !== goal.type) body.type = type;
        if (targetCents !== goal.targetCents) body.targetCents = targetCents;
        if (targetDate !== initialDate) body.targetDate = targetDate || null;
        if (categoryId !== initialCategory) body.categoryId = categoryId || null;
        saved = await updateGoal(goal._id, body);
        showSuccessToast('Goal updated');
      } else {
        const body: CreateGoalBody = { name, type, targetCents };
        if (targetDate) body.targetDate = targetDate;
        if (categoryId) body.categoryId = categoryId;
        saved = await createGoal(body);
        showSuccessToast('Goal created');
      }
      onSaved(saved);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong';
      setError(message);
      showErrorToast(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 max-w-md border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-800"
    >
      <h2 className="text-lg font-semibold">{isEditing ? 'Edit goal' : 'New goal'}</h2>

      <div>
        <label htmlFor="goal-name" className="block text-sm font-medium mb-1">
          Name
        </label>
        <input
          id="goal-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="goal-type" className="block text-sm font-medium mb-1">
          Type
        </label>
        <select
          id="goal-type"
          value={type}
          onChange={(e) => setType(e.target.value as GoalType)}
          className={inputClass}
        >
          <option value="savings">Savings</option>
          <option value="debt">Debt</option>
        </select>
        {type === 'debt' && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Set the target to the balance owed. Payments count up toward it.
          </p>
        )}
      </div>

      <div>
        <label htmlFor="goal-target" className="block text-sm font-medium mb-1">
          Target ($)
        </label>
        <input
          id="goal-target"
          // Text, not number: a number input accepts and normalizes forms
          // like "1e3", which should fail dollarsToCents with a clear message.
          inputMode="decimal"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="0.00"
          required
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="goal-date" className="block text-sm font-medium mb-1">
          Target date
        </label>
        <input
          id="goal-date"
          type="date"
          value={targetDate}
          onChange={(e) => setTargetDate(e.target.value)}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="goal-category" className="block text-sm font-medium mb-1">
          Category
        </label>
        <select
          id="goal-category"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className={inputClass}
        >
          <option value="">None</option>
          {currentCategoryMissing && (
            <option value={initialCategory} disabled>
              Current category (unavailable)
            </option>
          )}
          {categoryOptions.map((c) => (
            <option key={c._id} value={c._id}>
              {c.name}
            </option>
          ))}
        </select>
        {categoriesUnavailable && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Couldn&apos;t load categories. You can set one later.
          </p>
        )}
      </div>

      {error && <p className="text-red-500 dark:text-red-400 text-sm">{error}</p>}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Saving...' : isEditing ? 'Update' : 'Create'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
