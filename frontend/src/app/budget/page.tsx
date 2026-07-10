'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import {
  getBudget,
  setCategoryLimit,
  clearCategoryLimit,
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
  // Separate keys so a budget-only resync (e.g. after a failed save) doesn't
  // refetch the month-independent catalog; Retry bumps both.
  const [catalogReloadKey, setCatalogReloadKey] = useState(0);
  const [budgetReloadKey, setBudgetReloadKey] = useState(0);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  // The month a save response must match to be applied — a save resolving
  // after the user switched months is stale for the screen now showing.
  // Written in an effect (not during render) so a discarded concurrent render
  // can't leave it pointing at a month that never committed.
  const monthRef = useRef(month);
  useEffect(() => {
    monthRef.current = month;
  }, [month]);
  // Bumped whenever a save succeeds: any budget refetch that started before
  // the save carries pre-save data and must be dropped, whether it resolves
  // or rejects.
  const saveEpoch = useRef(0);

  // True once the catalog has loaded at least once: from then on a failed
  // refetch is a transient toast (the loaded catalog keeps serving), not a
  // permanent banner nothing would ever clear.
  const catalogLoaded = useRef(false);

  // The category catalog is month-independent — fetched once, and again only
  // on an explicit retry.
  useEffect(() => {
    let cancelled = false;
    Promise.all([listCategories(true), listCategoryGroups()])
      .then(([cs, gs]) => {
        if (cancelled) return;
        catalogLoaded.current = true;
        setCategories(cs);
        setGroups(gs);
        setCatalogError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : 'Failed to load categories';
        if (catalogLoaded.current) {
          showErrorToast(message);
        } else {
          setCatalogError(message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [catalogReloadKey]);

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
        // A pre-save fetch's failure is as stale as its data — don't paint an
        // error over the freshly saved view.
        if (cancelled || saveEpoch.current !== epoch) return;
        setBudgetError(
          err instanceof Error ? err.message : 'Failed to load budget',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [month, budgetReloadKey]);

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
    // The old month's failure isn't the new month's — show loading, not a
    // stale error, while the new fetch is in flight.
    setBudgetError(null);
    setMonth((m) => shiftMonth(m, delta));
  };

  const startEditing = (row: BudgetRow) => {
    setEditingId(row.categoryId);
    setEditValue(
      row.plannedCents > 0 ? (row.plannedCents / 100).toFixed(2) : '',
    );
  };

  // Delete the month's limit entry for a category. Used by the empty-save
  // path and by the Clear affordance on income rows with stale limits.
  const clearLimit = async (categoryId: string) => {
    setSaving(true);
    try {
      await clearCategoryLimit(monthRef.current, categoryId);
      saveEpoch.current += 1;
      // DELETE returns no view — refetch the month.
      setBudgetReloadKey((k) => k + 1);
      showSuccessToast('Limit cleared');
      setEditingId((prev) => (prev === categoryId ? null : prev));
    } catch (err) {
      showErrorToast(
        err instanceof Error ? err.message : 'Failed to clear limit',
      );
      // The write may still have applied — resync the budget.
      setBudgetReloadKey((k) => k + 1);
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async (e: FormEvent, row: BudgetRow) => {
    e.preventDefault();
    // An empty field means "no limit": delete the entry rather than upserting
    // a zero limit, which would pin a BudgetCategory document to the category
    // (blocking its hard-delete) for no reason. An explicit "0" is kept as a
    // deliberate zero limit. The view can't distinguish "no limit" from a
    // zero limit (both read plannedCents 0), so an empty save on a $0 row is
    // a no-op — never a destructive delete of a deliberate zero limit.
    if (editValue.trim() === '') {
      if (row.plannedCents === 0) {
        setEditingId((prev) => (prev === row.categoryId ? null : prev));
        return;
      }
      await clearLimit(row.categoryId);
      return;
    }
    const cents = dollarsToCents(editValue);
    if (cents === null) {
      showErrorToast('Enter a valid non-negative amount, e.g. 250.00');
      return;
    }
    setSaving(true);
    try {
      const res = await setCategoryLimit(
        monthRef.current,
        row.categoryId,
        cents,
      );
      saveEpoch.current += 1;
      // Apply the recomputed view the save returned; if the user has since
      // switched months it's stale — refetch the current month instead.
      if (res.month === monthRef.current) {
        setView(res);
        setBudgetError(null);
      } else {
        setBudgetReloadKey((k) => k + 1);
      }
      showSuccessToast('Limit saved');
      // Close only this row's editor — the user may have moved on to another
      // row while the save was in flight.
      setEditingId((prev) => (prev === row.categoryId ? null : prev));
    } catch (err) {
      showErrorToast(
        err instanceof Error ? err.message : 'Failed to save limit',
      );
      // The write may still have applied — resync the budget.
      setBudgetReloadKey((k) => k + 1);
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
              onClick={() => {
                setCatalogReloadKey((k) => k + 1);
                setBudgetReloadKey((k) => k + 1);
              }}
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
                        {editingId === row.categoryId ? null : row.isIncome &&
                          row.plannedCents === 0 ? (
                          '—'
                        ) : (
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
                        {/* Income "remaining" is informational noise — the
                            backend excludes income from every rollup. */}
                        {row.isIncome ? '—' : formatCents(row.remainingCents)}
                      </span>
                      {/* No editor on income rows: the backend excludes
                          income "limits" from every rollup, so a saved one
                          would silently disagree with the summary. A stale
                          income limit (set via API or an older UI) gets a
                          Clear affordance so it isn't pinned forever. */}
                      {!row.isArchived &&
                        !row.isIncome &&
                        editingId !== row.categoryId && (
                          <button
                            onClick={() => startEditing(row)}
                            aria-label={`Edit limit for ${row.name}`}
                            className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                          >
                            Edit
                          </button>
                        )}
                      {!row.isArchived &&
                        row.isIncome &&
                        row.plannedCents > 0 && (
                          <button
                            onClick={() => clearLimit(row.categoryId)}
                            disabled={saving}
                            aria-label={`Clear limit for ${row.name}`}
                            className="text-sm text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
                          >
                            Clear
                          </button>
                        )}
                    </div>
                    {editingId === row.categoryId && (
                      <form
                        onSubmit={(e) => handleSave(e, row)}
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
