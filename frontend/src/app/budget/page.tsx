'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import {
  getBudget,
  setCategoryLimit,
  buildBudgetGroups,
  shiftMonth,
  formatMonth,
  type BudgetView,
  type BudgetRow,
} from '@/lib/budget';
import { listCategories, listCategoryGroups } from '@/lib/categories';
import { showErrorToast, showSuccessToast } from '@/lib/toast';
import { formatCents, dollarsToCents } from '@/lib/utils';
import type { BudgetCategory, CategoryGroup } from '@/lib/types';

// Months are UTC-framed ("YYYY-MM" from toISOString) to match how transaction
// dates default (TransactionForm) and how the backend buckets actuals
// (monthToUtcRange) — a local-time default would drop a just-recorded
// transaction from the default view near month boundaries.
const currentMonth = () => new Date().toISOString().slice(0, 7);

function progressPercent(row: BudgetRow): number {
  if (row.plannedCents > 0) {
    return Math.min(
      100,
      Math.round((row.actualCents * 100) / row.plannedCents),
    );
  }
  return row.actualCents > 0 ? 100 : 0;
}

function SummaryCell({
  label,
  value,
  caption,
  negative,
  negativeBadge,
}: {
  label: string;
  value: number;
  caption?: string;
  negative?: boolean;
  negativeBadge?: string;
}) {
  return (
    <div className="flex-1 min-w-32">
      <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <p
        className={`text-lg font-semibold ${
          negative
            ? 'text-red-600 dark:text-red-400'
            : 'text-gray-900 dark:text-gray-100'
        }`}
      >
        {formatCents(value)}
      </p>
      {caption && (
        <p className="text-xs text-gray-500 dark:text-gray-400">{caption}</p>
      )}
      {negative && negativeBadge && (
        <p className="text-xs font-medium text-red-600 dark:text-red-400">
          {negativeBadge}
        </p>
      )}
    </div>
  );
}

export default function BudgetPage() {
  const [month, setMonth] = useState(currentMonth);
  const [view, setView] = useState<BudgetView | null>(null);
  const [groups, setGroups] = useState<CategoryGroup[] | null>(null);
  const [categories, setCategories] = useState<BudgetCategory[] | null>(null);
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  // The month a save response must match to be applied — a save resolving
  // after the user switched months is stale for the screen now showing.
  const monthRef = useRef(month);
  monthRef.current = month;
  // Bumped when a save response is applied: a budget refetch that started
  // before the latest applied save carries pre-save data and must be dropped.
  const saveEpoch = useRef(0);

  // The category catalog is month-independent — fetched once, and again only
  // on an explicit resync (reloadKey).
  useEffect(() => {
    let cancelled = false;
    Promise.all([listCategories(true), listCategoryGroups()])
      .then(([cs, gs]) => {
        if (cancelled) return;
        setCategories(cs);
        setGroups(gs);
        setCatalogError(null);
      })
      .catch((err) => {
        if (!cancelled) {
          setCatalogError(
            err instanceof Error ? err.message : 'Failed to load categories',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  useEffect(() => {
    let cancelled = false;
    const epoch = saveEpoch.current;
    getBudget(month)
      .then((v) => {
        if (cancelled || saveEpoch.current !== epoch) return;
        setView(v);
        setBudgetError(null);
      })
      .catch((err) => {
        if (!cancelled) {
          setBudgetError(
            err instanceof Error ? err.message : 'Failed to load budget',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [month, reloadKey]);

  // Only data for the selected month may render — after a month switch the
  // previous month's view is stale until the new fetch lands.
  const currentView = view && view.month === month ? view : null;
  const error = budgetError ?? catalogError;

  const grouped = useMemo(
    () =>
      currentView && categories && groups
        ? buildBudgetGroups(currentView, categories, groups)
        : [],
    [currentView, categories, groups],
  );

  const switchMonth = (delta: number) => {
    setEditingId(null);
    setMonth((m) => shiftMonth(m, delta));
  };

  const startEditing = (row: BudgetRow) => {
    setEditingId(row.categoryId);
    setEditValue(
      row.plannedCents > 0 ? (row.plannedCents / 100).toFixed(2) : '',
    );
  };

  const handleSave = async (e: FormEvent, categoryId: string) => {
    e.preventDefault();
    // An empty field means "no limit" — save it as zero.
    const cents =
      editValue.trim() === '' ? 0 : dollarsToCents(editValue);
    if (cents === null) {
      showErrorToast('Enter a valid non-negative amount, e.g. 250.00');
      return;
    }
    setSaving(true);
    try {
      const res = await setCategoryLimit(monthRef.current, categoryId, cents);
      saveEpoch.current += 1;
      // Apply the recomputed view the save returned; if the user has since
      // switched months it's stale — refetch the current month instead.
      if (res.month === monthRef.current) {
        setView(res);
      } else {
        setReloadKey((k) => k + 1);
      }
      // Close only this row's editor — the user may have moved on to another
      // row while the save was in flight.
      setEditingId((prev) => (prev === categoryId ? null : prev));
      showSuccessToast('Limit saved');
    } catch (err) {
      showErrorToast(
        err instanceof Error ? err.message : 'Failed to save limit',
      );
      // The write may still have applied — resync.
      setReloadKey((k) => k + 1);
    } finally {
      setSaving(false);
    }
  };

  const ready = currentView !== null && categories !== null && groups !== null;

  return (
    <main className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Budget
        </h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => switchMonth(-1)}
            aria-label="Previous month"
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            ‹
          </button>
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100 min-w-32 text-center">
            {formatMonth(month)}
          </span>
          <button
            onClick={() => switchMonth(1)}
            aria-label="Next month"
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            ›
          </button>
        </div>
      </div>

      {!ready ? (
        error ? (
          <div>
            <p className="text-red-600 dark:text-red-400">{error}</p>
            <button
              onClick={() => setReloadKey((k) => k + 1)}
              className="mt-3 px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg"
            >
              Retry
            </button>
          </div>
        ) : (
          <p className="text-gray-500 dark:text-gray-400">Loading budget…</p>
        )
      ) : (
        <>
          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}

          <section
            aria-label="Budget summary"
            className="flex flex-wrap gap-6 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 p-4"
          >
            <SummaryCell label="Planned" value={currentView.totalPlannedCents} />
            <SummaryCell label="Spent" value={currentView.totalActualCents} />
            <SummaryCell
              label="To be budgeted"
              value={currentView.toBeBudgetedCents}
              caption={`of ${formatCents(currentView.incomeCents)} income`}
              negative={currentView.toBeBudgetedCents < 0}
              negativeBadge="Over-allocated"
            />
          </section>

          {grouped.length === 0 ? (
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 p-8 text-center">
          <p className="text-gray-500 dark:text-gray-400">
            Set up your categories to start budgeting.
          </p>
          <Link
            href="/categories"
            className="mt-3 inline-block px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Manage categories
          </Link>
        </div>
      ) : (
        grouped.map((g) => (
          <section
            key={g.groupId}
            aria-label={g.name}
            className="border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800"
          >
            <h2 className="px-4 py-3 text-sm font-semibold text-gray-900 dark:text-gray-100 border-b border-gray-200 dark:border-gray-700">
              {g.name}
            </h2>
            <ul className="divide-y divide-gray-200 dark:divide-gray-700">
              {g.rows.map((row) => {
                const overBudget = !row.isIncome && row.remainingCents < 0;
                const pct = progressPercent(row);
                return (
                  <li key={row.categoryId} className="px-4 py-3 space-y-2">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <span className="flex-1 min-w-40 font-medium text-gray-900 dark:text-gray-100">
                        {row.name}
                        {row.isIncome && (
                          <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                            Income
                          </span>
                        )}
                        {row.isArchived && (
                          <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                            (archived)
                          </span>
                        )}
                        {overBudget && (
                          <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
                            Over budget
                          </span>
                        )}
                      </span>
                      <span className="text-sm text-gray-600 dark:text-gray-300 w-24 text-right">
                        {editingId === row.categoryId ? null : (
                          <>{formatCents(row.plannedCents)}</>
                        )}
                      </span>
                      <span className="text-sm text-gray-600 dark:text-gray-300 w-24 text-right">
                        {formatCents(row.actualCents)}
                      </span>
                      <span
                        className={`text-sm w-24 text-right ${
                          overBudget
                            ? 'text-red-600 dark:text-red-400 font-medium'
                            : 'text-gray-600 dark:text-gray-300'
                        }`}
                      >
                        {formatCents(row.remainingCents)}
                      </span>
                      {!row.isArchived && editingId !== row.categoryId && (
                        <button
                          onClick={() => startEditing(row)}
                          aria-label={`Edit limit for ${row.name}`}
                          className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          Edit
                        </button>
                      )}
                    </div>
                    {editingId === row.categoryId && (
                      <form
                        onSubmit={(e) => handleSave(e, row.categoryId)}
                        className="flex gap-2"
                      >
                        <input
                          aria-label={`Monthly limit for ${row.name}`}
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          inputMode="decimal"
                          placeholder="0.00"
                          autoFocus
                          className="w-32 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700"
                        />
                        <button
                          type="submit"
                          disabled={saving}
                          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg"
                        >
                          Cancel
                        </button>
                      </form>
                    )}
                    <div
                      className="h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden"
                      role="progressbar"
                      aria-label={`${row.name} spending progress`}
                      aria-valuenow={pct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <div
                        aria-hidden="true"
                        className={`h-full rounded-full ${
                          overBudget
                            ? 'bg-red-500'
                            : row.isIncome
                              ? 'bg-green-500'
                              : 'bg-blue-500'
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
          )}
        </>
      )}
    </main>
  );
}
