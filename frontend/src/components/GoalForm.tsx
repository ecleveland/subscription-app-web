'use client';

import { useState, type FormEvent } from 'react';
import {
  accountFitsGoal,
  createGoal,
  updateGoal,
  type CreateGoalBody,
  type UpdateGoalBody,
} from '@/lib/goals';
import { dollarsToCents } from '@/lib/utils';
import { showErrorToast, showSuccessToast } from '@/lib/toast';
import { useAccounts } from '@/lib/accounts-context';
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
  'w-full border border-line-strong rounded-md px-3 py-2 bg-surface';

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
  const initialAccount = goal?.linkedAccount?.accountId ?? '';

  const [name, setName] = useState(goal?.name ?? '');
  const [type, setType] = useState<GoalType>(goal?.type ?? 'savings');
  const [target, setTarget] = useState(goal ? String(goal.targetCents / 100) : '');
  const [targetDate, setTargetDate] = useState(initialDate);
  const [categoryId, setCategoryId] = useState(initialCategory);
  const [accountId, setAccountId] = useState(initialAccount);
  const { accounts, loading: accountsLoading, error: accountsError } = useAccounts();
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

  const accountOptions = accounts.filter(
    (a) => !a.isArchived && accountFitsGoal(type, a.type),
  );
  // The shown and saved account derives from type, so switching the type away
  // and back restores the pick. A known account must fit the current type. An
  // account missing from the list has no known type: it may be archived, or
  // the list may still be loading or have failed. It survives only while the
  // type is unchanged, because the savings and debt account types are
  // disjoint and a changed type always rules it out.
  const selectedAccount = accounts.find((a) => a._id === accountId);
  const linkFits =
    !accountId ||
    (selectedAccount
      ? accountFitsGoal(type, selectedAccount.type)
      : type === goal?.type);
  const effectiveAccountId = linkFits ? accountId : '';
  // Without a placeholder the select would show "None" for a stored id with no
  // option, and picking "None" would never fire onChange. Same reasoning as the
  // category select.
  const linkedAccountMissing =
    !!initialAccount && !accountOptions.some((a) => a._id === initialAccount);
  // A linked account that is listed and unarchived is known, so it is missing
  // from the options only because it doesn't fit the current type.
  const linkedAccountUnfit = accounts.some(
    (a) => a._id === initialAccount && !a.isArchived,
  );
  const linkedAccountReason = linkedAccountUnfit
    ? "(doesn't fit this goal type)"
    : accountsError
      ? '(could not load accounts)'
      : '(archived or unavailable)';

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
        if (effectiveAccountId !== initialAccount) {
          body.accountId = effectiveAccountId || null;
        }
        saved = await updateGoal(goal._id, body);
        showSuccessToast('Goal updated');
      } else {
        const body: CreateGoalBody = { name, type, targetCents };
        if (targetDate) body.targetDate = targetDate;
        if (categoryId) body.categoryId = categoryId;
        if (effectiveAccountId) body.accountId = effectiveAccountId;
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
      className="space-y-4 max-w-md border border-line rounded-md p-4 bg-surface"
    >
      <h2 className="section-title">{isEditing ? 'Edit goal' : 'New goal'}</h2>

      <div>
        <label htmlFor="goal-name" className="label">
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
        <label htmlFor="goal-type" className="label">
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
          <p className="text-xs text-muted mt-1">
            Set the target to the balance owed. Payments count up toward it.
          </p>
        )}
      </div>

      <div>
        <label htmlFor="goal-target" className="label">
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
        <label htmlFor="goal-date" className="label">
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
        <label htmlFor="goal-category" className="label">
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
          <p className="text-xs text-muted mt-1">
            Couldn&apos;t load categories. You can set one later.
          </p>
        )}
      </div>

      <div>
        <label htmlFor="goal-account" className="label">
          Account
        </label>
        <select
          id="goal-account"
          value={effectiveAccountId}
          onChange={(e) => setAccountId(e.target.value)}
          disabled={accountsLoading}
          className={`${inputClass} disabled:opacity-50`}
        >
          {accountsLoading ? (
            <option value={effectiveAccountId}>Loading accounts...</option>
          ) : (
            <>
              <option value="">None (manual)</option>
              {linkedAccountMissing && (
                <option value={initialAccount} disabled>
                  {goal?.linkedAccount?.name} {linkedAccountReason}
                </option>
              )}
              {accountOptions.map((a) => (
                <option key={a._id} value={a._id}>
                  {a.name}
                </option>
              ))}
            </>
          )}
        </select>
        {accountsError && (
          <p className="text-xs text-muted mt-1">
            Couldn&apos;t load accounts. You can link one later.
          </p>
        )}
      </div>

      {error && <p className="text-danger text-sm">{error}</p>}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={loading}
          className="btn-primary"
        >
          {loading ? 'Saving...' : isEditing ? 'Update' : 'Create'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="btn-secondary"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
