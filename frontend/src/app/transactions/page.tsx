'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAccounts } from '@/lib/accounts-context';
import {
  listTransactions,
  deleteTransaction,
  type TransactionFilters,
} from '@/lib/transactions';
import { listCategories } from '@/lib/categories';
import { formatCents, formatDate } from '@/lib/utils';
import { showErrorToast, showSuccessToast } from '@/lib/toast';
import TransactionForm from '@/components/TransactionForm';
import CsvImportWizard from '@/components/CsvImportWizard';
import ConfirmDialog from '@/components/ConfirmDialog';
import type {
  BudgetCategory,
  PaginationMeta,
  Transaction,
  TransactionType,
} from '@/lib/types';

const PAGE_SIZE = 20;

export default function TransactionsPage() {
  const {
    accounts,
    error: accountsError,
    refresh: refreshAccounts,
  } = useAccounts();
  const [categories, setCategories] = useState<BudgetCategory[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [deleting, setDeleting] = useState<Transaction | null>(null);

  // Filters.
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [type, setType] = useState<'' | TransactionType>('');
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
  // Archived categories keep labeling their historical rows (the name map
  // above uses the full list) but are not offered for new activity.
  const activeCategories = useMemo(
    () => categories.filter((c) => !c.isArchived),
    [categories],
  );
  // When editing a transaction whose category has since been archived, keep
  // that one category selectable so the select doesn't render blank and
  // misrepresent the saved assignment (the backend allows keeping it — only
  // re-pointing a transaction at an archived category is rejected).
  const formCategories = useMemo(() => {
    if (!editing?.categoryId) return activeCategories;
    const current = categories.find((c) => c._id === editing.categoryId);
    return current?.isArchived
      ? [...activeCategories, current]
      : activeCategories;
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
    const filters: TransactionFilters = { page, limit: PAGE_SIZE };
    if (accountId) filters.accountId = accountId;
    if (categoryId) filters.categoryId = categoryId;
    if (type) filters.type = type;
    listTransactions(filters)
      .then((res) => {
        if (cancelled) return;
        setTransactions(res.data);
        setMeta(res.meta);
        setListError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : 'Failed to load transactions';
        setListError(message);
        showErrorToast(message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page, accountId, categoryId, type, reloadKey]);

  async function afterMutation() {
    setShowCreate(false);
    setEditing(null);
    setReloadKey((k) => k + 1);
    // The write succeeded; if the follow-up balance refresh fails, say so
    // rather than silently showing stale balances.
    try {
      await refreshAccounts();
    } catch {
      showErrorToast('Saved, but balances may be out of date — refresh to update.');
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    try {
      await deleteTransaction(deleting._id);
      showSuccessToast('Transaction deleted');
      setDeleting(null);
      await afterMutation();
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to delete');
    }
  }

  function signedAmount(t: Transaction): string {
    if (t.type === 'income') return `+${formatCents(t.amountCents)}`;
    if (t.type === 'expense') return `-${formatCents(t.amountCents)}`;
    return formatCents(t.amountCents);
  }

  const canAdd = accounts.length > 0;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Transactions</h1>
        {!showCreate && !editing && !showImport && (
          <div className="flex gap-3">
            <button
              onClick={() => setShowImport(true)}
              disabled={!canAdd}
              title={canAdd ? '' : 'Create an account first'}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
            >
              Import CSV
            </button>
            <button
              onClick={() => setShowCreate(true)}
              disabled={!canAdd}
              title={canAdd ? '' : 'Create an account first'}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              + Add transaction
            </button>
          </div>
        )}
      </div>

      {accountsError && (
        <p className="text-red-500 text-sm mb-4">
          Couldn’t load accounts: {accountsError}. Transactions may be incomplete.
        </p>
      )}

      {!canAdd && !accountsError && (
        <p className="text-sm text-gray-500 mb-4">
          Create an account before recording transactions.
        </p>
      )}

      {(showCreate || editing) && (
        <div className="mb-6">
          <TransactionForm
            // Remount when the target changes: the form's field state
            // initializes from the transaction prop only on mount.
            key={editing?._id ?? 'new'}
            transaction={editing ?? undefined}
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

      {showImport && (
        <div className="mb-6">
          <CsvImportWizard
            accounts={accounts}
            onImported={afterMutation}
            onCancel={() => setShowImport(false)}
          />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <select
          aria-label="Filter by account"
          value={accountId}
          onChange={(e) => {
            setPage(1);
            setAccountId(e.target.value);
          }}
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
          onChange={(e) => {
            setPage(1);
            setCategoryId(e.target.value);
          }}
          className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 text-sm"
        >
          <option value="">All categories</option>
          {/* Rows can display archived categories, so the filter must offer
              them too — flagged to distinguish them from active ones. */}
          {categories.map((c) => (
            <option key={c._id} value={c._id}>
              {c.isArchived ? `${c.name} (archived)` : c.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by type"
          value={type}
          onChange={(e) => {
            setPage(1);
            setType(e.target.value as '' | TransactionType);
          }}
          className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 text-sm"
        >
          <option value="">All types</option>
          <option value="income">Income</option>
          <option value="expense">Expense</option>
          <option value="transfer">Transfer</option>
        </select>
      </div>

      {loading ? (
        <p className="text-gray-500">Loading transactions…</p>
      ) : listError ? (
        <p className="text-red-500 text-center py-8">
          Couldn’t load transactions: {listError}
        </p>
      ) : transactions.length === 0 ? (
        <p className="text-gray-500 text-center py-8">No transactions found.</p>
      ) : (
        <ul className="space-y-2">
          {transactions.map((t) => (
            <li
              key={t._id}
              className="flex items-center justify-between border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-3 bg-white dark:bg-gray-800"
            >
              <div className="min-w-0">
                <p className="font-medium truncate">
                  {t.type === 'transfer'
                    ? `Transfer: ${accountName.get(t.accountId) ?? '—'} → ${
                        accountName.get(t.transferAccountId ?? '') ?? '—'
                      }`
                    : t.payee || categoryName.get(t.categoryId ?? '') || '—'}
                </p>
                <p className="text-xs text-gray-500">
                  {formatDate(t.date)} · {accountName.get(t.accountId) ?? '—'}
                  {t.type !== 'transfer' &&
                    t.categoryId &&
                    ` · ${categoryName.get(t.categoryId) ?? ''}`}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <span
                  className={
                    t.type === 'expense'
                      ? 'font-semibold text-red-600'
                      : t.type === 'income'
                        ? 'font-semibold text-green-600'
                        : 'font-semibold'
                  }
                >
                  {signedAmount(t)}
                </span>
                <button
                  onClick={() => {
                    setShowCreate(false);
                    setEditing(t);
                  }}
                  className="text-sm text-gray-600 dark:text-gray-300 hover:underline"
                >
                  Edit
                </button>
                <button
                  onClick={() => setDeleting(t)}
                  className="text-sm text-red-600 hover:underline"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {meta && meta.totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 mt-6">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-sm text-gray-500">
            Page {meta.page} of {meta.totalPages}
          </span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={!meta.hasNextPage}
            className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Delete transaction"
        message="Delete this transaction? The account balance will be adjusted."
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setDeleting(null)}
        destructive
      />
    </div>
  );
}
