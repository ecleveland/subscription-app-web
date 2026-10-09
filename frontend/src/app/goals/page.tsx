'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { contributeToGoal, listGoals, updateGoal } from '@/lib/goals';
import { listCategories } from '@/lib/categories';
import { showErrorToast, showSuccessToast } from '@/lib/toast';
import GoalCard from '@/components/GoalCard';
import GoalForm from '@/components/GoalForm';
import type { BudgetCategory, Goal } from '@/lib/types';

const errorMessage = (err: unknown, fallback: string) =>
  err instanceof Error ? err.message : fallback;

export default function GoalsPage() {
  const { isAuthenticated } = useAuth();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [categories, setCategories] = useState<BudgetCategory[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Goal | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    // Guards against a slow response for the previous showArchived value
    // landing after the current one.
    let cancelled = false;
    listGoals(showArchived)
      .then((list) => {
        if (!cancelled) {
          setGoals(list);
          setError(null);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        // Drop the previous filter's list so archived goals never linger
        // with the box unchecked (or the reverse).
        setGoals([]);
        setError(errorMessage(err, 'Failed to load goals'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, showArchived]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    listCategories()
      .then((list) => {
        if (!cancelled) setCategories(list);
      })
      .catch((err) => {
        // Goals still work without categories; only the picker is empty.
        showErrorToast(errorMessage(err, 'Failed to load categories'));
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  function replaceGoal(updated: Goal) {
    setGoals((prev) =>
      updated.isArchived && !showArchived
        ? prev.filter((g) => g._id !== updated._id)
        : prev.map((g) => (g._id === updated._id ? updated : g)),
    );
  }

  function handleSaved(saved: Goal) {
    if (editing) {
      replaceGoal(saved);
    } else {
      setGoals((prev) => [saved, ...prev]);
    }
    setShowCreate(false);
    setEditing(null);
  }

  async function handleArchiveToggle(goal: Goal) {
    const isArchived = !goal.isArchived;
    try {
      replaceGoal(await updateGoal(goal._id, { isArchived }));
      showSuccessToast(isArchived ? 'Goal archived' : 'Goal restored');
    } catch (err) {
      showErrorToast(errorMessage(err, 'Failed to update goal'));
    }
  }

  async function handleContribute(id: string, amountCents: number): Promise<boolean> {
    try {
      replaceGoal(await contributeToGoal(id, amountCents));
      showSuccessToast('Contribution added');
      return true;
    } catch (err) {
      showErrorToast(errorMessage(err, 'Failed to add contribution'));
      return false;
    }
  }

  const addButton = (
    <button
      onClick={() => {
        setEditing(null);
        setShowCreate(true);
      }}
      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
    >
      + Add goal
    </button>
  );

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Goals</h1>
        {!showCreate && !editing && goals.length > 0 && addButton}
      </div>

      <label className="inline-flex items-center gap-2 mb-4 text-sm text-gray-700 dark:text-gray-300">
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(e) => {
            setLoading(true);
            setShowArchived(e.target.checked);
          }}
        />
        Show archived
      </label>

      {error && <p className="text-red-500 dark:text-red-400 text-sm mb-4">{error}</p>}

      {showCreate && (
        <div className="mb-6">
          <GoalForm
            categories={categories}
            onSaved={handleSaved}
            onCancel={() => setShowCreate(false)}
          />
        </div>
      )}

      {editing && (
        <div className="mb-6">
          <GoalForm
            key={editing._id}
            goal={editing}
            categories={categories}
            onSaved={handleSaved}
            onCancel={() => setEditing(null)}
          />
        </div>
      )}

      {loading ? (
        <p className="text-gray-500 dark:text-gray-400">Loading goals…</p>
      ) : goals.length === 0 ? (
        !showCreate &&
        !error && (
          <div className="text-center py-8">
            <p className="text-gray-500 dark:text-gray-400 mb-3">
              No goals yet. Add a savings target or a debt to pay down.
            </p>
            {addButton}
          </div>
        )
      ) : (
        <ul className="space-y-3">
          {goals.map((goal) => (
            <li key={goal._id}>
              <GoalCard
                goal={goal}
                onEdit={(g) => {
                  setShowCreate(false);
                  setEditing(g);
                }}
                onArchiveToggle={handleArchiveToggle}
                onContribute={handleContribute}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
