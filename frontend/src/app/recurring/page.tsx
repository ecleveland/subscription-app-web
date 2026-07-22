'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAccounts } from '@/lib/accounts-context';
import {
  listRecurring,
  deleteRecurring,
  upcomingWithin,
  signedCents,
  cadenceLabel,
  type RecurringFilters,
} from '@/lib/recurring';
import { listCategories } from '@/lib/categories';
import { formatDate } from '@/lib/utils';
import { showErrorToast, showSuccessToast } from '@/lib/toast';
import RecurringForm from '@/components/RecurringForm';
import ConfirmDialog from '@/components/ConfirmDialog';
import type {
  BudgetCategory,
  RecurringTransaction,
  RecurringType,
} from '@/lib/types';

const UPCOMING_DAYS = 30;

function amountClass(type: RecurringType): string {
  return type === 'income'
    ? 'font-semibold text-green-600'
    : 'font-semibold text-red-600';
}

export default function RecurringPage() {
  const {
    accounts,
    error: accountsError,
    refresh: refreshAccounts,
  } = useAccounts();
  const [categories, setCategories] = useState<BudgetCategory[]>([]);
  const [recurring, setRecurring] = useState<RecurringTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<RecurringTransaction | null>(null);
  const [deleting, setDeleting] = useState<RecurringTransaction | null>(null);

  // Filters.
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [type, setType] = useState<'' | RecurringType>('');
  // Bumped to force a re-fetch after a mutation.
  const [reloadKey, setReloadKey] = useState(0);

  const accountName = useMemo(
    () => new Map(accounts.map((a) => [a._id, a.name])),
    [accounts],
  );
  const categoryName = useMemo(
    () => new Map(categories.map((c) => [c._id, c.name])),
    [categories],
  );
  const activeCategories = useMemo(
    () => categories.filter((c) => !c.isArchived),
    [categories],
  );
  // When editing a schedule whose category has since been archived, keep that
  // one category selectable so the form's select doesn't render blank.
  const formCategories = useMemo(() => {
    if (!editing?.categoryId) return activeCategories;
    const current = categories.find((c) => c._id === editing.categoryId);
    return current?.isArchived ? [...activeCategories, current] : activeCategories;
  }, [activeCategories, categories, editing]);

  useEffect(() => {
    listCategories(true)
      .then(setCategories)
      .catch((err) =>
        showErrorToast(
          err instanceof Error ? err.message : 'Failed to load categories',
        ),
      );
  }, []);

  useEffect(() => {
    let cancelled = false;
    const filters: RecurringFilters = {};
    if (accountId) filters.accountId = accountId;
    if (categoryId) filters.categoryId = categoryId;
    if (type) filters.type = type;
    listRecurring(filters)
      .then((data) => {
        if (cancelled) return;
        setRecurring(data);
        setListError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : 'Failed to load schedules';
        setListError(message);
        showErrorToast(message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, categoryId, type, reloadKey]);

  async function afterMutation() {
    setShowCreate(false);
    setEditing(null);
    setReloadKey((k) => k + 1);
    // A materialized-on-create schedule can touch a balance; keep balances
    // fresh, and say so if the refresh fails rather than showing stale ones.
    try {
      await refreshAccounts();
    } catch {
      showErrorToast('Saved, but balances may be out of date — refresh to update.');
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    try {
      await deleteRecurring(deleting._id);
      showSuccessToast('Schedule deleted');
      setDeleting(null);
      await afterMutation();
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to delete');
    }
  }

  const upcoming = useMemo(
    () => upcomingWithin(recurring, UPCOMING_DAYS),
    [recurring],
  );
  const canAdd = accounts.length > 0;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Bills &amp; recurring</h1>
        {!showCreate && !editing && (
          <button
            onClick={() => setShowCreate(true)}
            disabled={!canAdd}
            title={canAdd ? '' : 'Create an account first'}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            + Add bill
          </button>
        )}
      </div>

      {accountsError && (
        <p className="text-red-500 text-sm mb-4">
          Couldn’t load accounts: {accountsError}. Schedules may be incomplete.
        </p>
      )}

      {!canAdd && !accountsError && (
        <p className="text-sm text-gray-500 mb-4">
          Create an account before adding recurring schedules.
        </p>
      )}

      {(showCreate || editing) && (
        <div className="mb-6">
          <RecurringForm
            // Remount when the target changes: the form initializes its field
            // state from the recurring prop only on mount.
            key={editing?._id ?? 'new'}
            recurring={editing ?? undefined}
            accounts={accounts}
            categories={formCategories}
            onSaved={afterMutation}
            onCancel={() => {
              setShowCreate(false);
              setEditing(null);
            }}
          />
        </div>
      )}

      {/* Upcoming — what's due in the next 30 days (bills + paychecks). */}
      <section
        aria-label={`Upcoming (next ${UPCOMING_DAYS} days)`}
        className="mb-6 border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-800"
      >
        <h2 className="text-lg font-semibold mb-3">
          Upcoming (next {UPCOMING_DAYS} days)
        </h2>
        {upcoming.length === 0 ? (
          <p className="text-sm text-gray-500">
            Nothing due in the next {UPCOMING_DAYS} days.
          </p>
        ) : (
          <ul className="space-y-1">
            {upcoming.map((r) => (
              <li
                key={r._id}
                className="flex items-center justify-between text-sm"
              >
                <span className="min-w-0 truncate">
                  {formatDate(r.nextDate)} · <span>{r.payee}</span>
                </span>
                <span className={amountClass(r.type)}>
                  {signedCents(r.type, r.amountCents)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <select
          aria-label="Filter by account"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 text-sm"
        >
          <option value="">All accounts</option>
          {accounts.map((a) => (
            <option key={a._id} value={a._id}>
              {a.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by category"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 text-sm"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c._id} value={c._id}>
              {c.isArchived ? `${c.name} (archived)` : c.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by type"
          value={type}
          onChange={(e) => setType(e.target.value as '' | RecurringType)}
          className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 text-sm"
        >
          <option value="">All types</option>
          <option value="expense">Bills</option>
          <option value="income">Income</option>
        </select>
      </div>

      {loading ? (
        <p className="text-gray-500">Loading schedules…</p>
      ) : listError ? (
        <p className="text-red-500 text-center py-8">
          Couldn’t load schedules: {listError}
        </p>
      ) : recurring.length === 0 ? (
        <p className="text-gray-500 text-center py-8">No schedules found.</p>
      ) : (
        <ul className="space-y-2">
          {recurring.map((r) => (
            <li
              key={r._id}
              className="flex items-center justify-between border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-3 bg-white dark:bg-gray-800"
            >
              <div className="min-w-0">
                <p className="font-medium truncate">
                  {r.payee}
                  <span className="ml-2 text-xs font-normal text-gray-500">
                    {r.type === 'income' ? 'Income' : 'Bill'}
                  </span>
                </p>
                <p className="text-xs text-gray-500">
                  {cadenceLabel(r.cadence)} · next {formatDate(r.nextDate)}
                  {r.categoryId &&
                    ` · ${categoryName.get(r.categoryId) ?? ''}`}
                  {` · ${accountName.get(r.accountId ?? '') ?? '—'}`}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <span className={amountClass(r.type)}>
                  {signedCents(r.type, r.amountCents)}
                </span>
                <Link
                  href={`/transactions?recurringId=${r._id}`}
                  className="text-sm text-gray-600 dark:text-gray-300 hover:underline"
                >
                  History
                </Link>
                <button
                  onClick={() => {
                    setShowCreate(false);
                    setEditing(r);
                  }}
                  className="text-sm text-gray-600 dark:text-gray-300 hover:underline"
                >
                  Edit
                </button>
                <button
                  onClick={() => setDeleting(r)}
                  className="text-sm text-red-600 hover:underline"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Delete schedule"
        message="Delete this recurring schedule? Its already-recorded transactions are kept."
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setDeleting(null)}
        destructive
      />
    </div>
  );
}
