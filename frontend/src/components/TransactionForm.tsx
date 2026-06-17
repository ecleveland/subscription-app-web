'use client';

import { useState, type FormEvent } from 'react';
import {
  createTransaction,
  updateTransaction,
  type TransactionInput,
} from '@/lib/transactions';
import { dollarsToCents } from '@/lib/utils';
import { showErrorToast, showSuccessToast } from '@/lib/toast';
import type {
  Account,
  BudgetCategory,
  Transaction,
  TransactionType,
} from '@/lib/types';

interface Props {
  transaction?: Transaction;
  accounts: Account[];
  categories: BudgetCategory[];
  onSaved: () => void;
  onCancel: () => void;
}

const TYPES: TransactionType[] = ['expense', 'income', 'transfer'];

export default function TransactionForm({
  transaction,
  accounts,
  categories,
  onSaved,
  onCancel,
}: Props) {
  const isEditing = !!transaction;
  const [type, setType] = useState<TransactionType>(
    transaction?.type ?? 'expense',
  );
  const [accountId, setAccountId] = useState(
    transaction?.accountId ?? accounts[0]?._id ?? '',
  );
  const [transferAccountId, setTransferAccountId] = useState(
    transaction?.transferAccountId ?? '',
  );
  const [categoryId, setCategoryId] = useState(transaction?.categoryId ?? '');
  const [amount, setAmount] = useState(
    transaction ? (transaction.amountCents / 100).toFixed(2) : '',
  );
  const [date, setDate] = useState(
    transaction?.date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
  );
  const [payee, setPayee] = useState(transaction?.payee ?? '');
  const [notes, setNotes] = useState(transaction?.notes ?? '');
  const [cleared, setCleared] = useState(transaction?.cleared ?? false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isTransfer = type === 'transfer';
  // Offer income categories for income, expense categories for expense.
  const selectableCategories = categories.filter(
    (c) => c.isIncome === (type === 'income'),
  );

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    const amountCents = dollarsToCents(amount);
    if (amountCents === null || amountCents <= 0) {
      setError('Amount must be a positive number');
      return;
    }
    if (isTransfer && transferAccountId === accountId) {
      setError('A transfer must use two different accounts');
      return;
    }
    if (!isTransfer && !categoryId) {
      setError('Please choose a category');
      return;
    }

    const body: TransactionInput = {
      accountId,
      type,
      amountCents,
      date,
      payee: payee.trim() || undefined,
      notes: notes.trim() || undefined,
      cleared,
      ...(isTransfer
        ? { transferAccountId }
        : { categoryId }),
    };

    setLoading(true);
    try {
      if (isEditing) {
        await updateTransaction(transaction._id, body);
        showSuccessToast('Transaction updated');
      } else {
        await createTransaction(body);
        showSuccessToast('Transaction added');
      }
      onSaved();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong';
      setError(message);
      showErrorToast(message);
    } finally {
      setLoading(false);
    }
  }

  const inputClass =
    'w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700';

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 max-w-md border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-800"
    >
      <h2 className="text-lg font-semibold">
        {isEditing ? 'Edit transaction' : 'New transaction'}
      </h2>

      <div>
        <label htmlFor="txn-type" className="block text-sm font-medium mb-1">
          Type
        </label>
        <select
          id="txn-type"
          value={type}
          onChange={(e) => setType(e.target.value as TransactionType)}
          className={inputClass}
        >
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="txn-account" className="block text-sm font-medium mb-1">
          {isTransfer ? 'From account' : 'Account'}
        </label>
        <select
          id="txn-account"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          required
          className={inputClass}
        >
          {accounts.map((a) => (
            <option key={a._id} value={a._id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>

      {isTransfer ? (
        <div>
          <label htmlFor="txn-to" className="block text-sm font-medium mb-1">
            To account
          </label>
          <select
            id="txn-to"
            value={transferAccountId}
            onChange={(e) => setTransferAccountId(e.target.value)}
            required
            className={inputClass}
          >
            <option value="">Select account…</option>
            {accounts
              .filter((a) => a._id !== accountId)
              .map((a) => (
                <option key={a._id} value={a._id}>
                  {a.name}
                </option>
              ))}
          </select>
        </div>
      ) : (
        <div>
          <label htmlFor="txn-category" className="block text-sm font-medium mb-1">
            Category
          </label>
          <select
            id="txn-category"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className={inputClass}
          >
            <option value="">Select category…</option>
            {selectableCategories.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label htmlFor="txn-amount" className="block text-sm font-medium mb-1">
          Amount ($)
        </label>
        <input
          id="txn-amount"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          required
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="txn-date" className="block text-sm font-medium mb-1">
          Date
        </label>
        <input
          id="txn-date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
          className={inputClass}
        />
      </div>

      {!isTransfer && (
        <div>
          <label htmlFor="txn-payee" className="block text-sm font-medium mb-1">
            Payee
          </label>
          <input
            id="txn-payee"
            value={payee}
            onChange={(e) => setPayee(e.target.value)}
            className={inputClass}
          />
        </div>
      )}

      <div>
        <label htmlFor="txn-notes" className="block text-sm font-medium mb-1">
          Notes
        </label>
        <textarea
          id="txn-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className={inputClass}
        />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={cleared}
          onChange={(e) => setCleared(e.target.checked)}
        />
        Cleared
      </label>

      {error && <p className="text-red-500 text-sm">{error}</p>}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Saving...' : isEditing ? 'Update' : 'Add'}
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
