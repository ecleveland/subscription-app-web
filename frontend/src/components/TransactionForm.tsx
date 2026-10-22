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
      // On edit, send the empty string so a blanked field is cleared; on create
      // omit it when blank.
      payee: isEditing ? payee.trim() : payee.trim() || undefined,
      notes: isEditing ? notes.trim() : notes.trim() || undefined,
      cleared,
      ...(isTransfer ? { transferAccountId } : { categoryId }),
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
    'w-full border border-line-strong rounded-md px-3 py-2 bg-surface';

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 max-w-md border border-line rounded-md p-4 bg-surface"
    >
      <h2 className="section-title">
        {isEditing ? 'Edit transaction' : 'New transaction'}
      </h2>

      <div>
        <label htmlFor="txn-type" className="label">
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
        <label htmlFor="txn-account" className="label">
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
          <label htmlFor="txn-to" className="label">
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
          <label htmlFor="txn-category" className="label">
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
        <label htmlFor="txn-amount" className="label">
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
        <label htmlFor="txn-date" className="label">
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
          <label htmlFor="txn-payee" className="label">
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
        <label htmlFor="txn-notes" className="label">
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

      {error && <p className="text-danger text-sm">{error}</p>}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={loading}
          className="btn-primary"
        >
          {loading ? 'Saving...' : isEditing ? 'Update' : 'Add'}
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
