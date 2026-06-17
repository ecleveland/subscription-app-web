'use client';

import { useState, type FormEvent } from 'react';
import { createAccount, updateAccount } from '@/lib/accounts';
import { dollarsToCents, formatCents } from '@/lib/utils';
import { showErrorToast, showSuccessToast } from '@/lib/toast';
import { ACCOUNT_TYPES, type Account, type AccountType } from '@/lib/types';

interface Props {
  account?: Account;
  onSaved: () => void;
  onCancel: () => void;
}

export default function AccountForm({ account, onSaved, onCancel }: Props) {
  const isEditing = !!account;
  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState<AccountType>(account?.type ?? 'checking');
  // Opening balance only on create; editing the running balance is derived.
  const [openingBalance, setOpeningBalance] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    let balanceCents: number | undefined;
    if (!isEditing && openingBalance.trim() !== '') {
      const cents = dollarsToCents(openingBalance);
      if (cents === null) {
        setError('Opening balance must be a valid amount');
        return;
      }
      // Credit/loan accounts hold what you owe as a negative balance.
      balanceCents = type === 'credit' || type === 'loan' ? -cents : cents;
    }

    setLoading(true);
    try {
      if (isEditing) {
        await updateAccount(account._id, { name, type });
        showSuccessToast('Account updated');
      } else {
        await createAccount({ name, type, balanceCents });
        showSuccessToast('Account created');
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

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 max-w-md border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-800"
    >
      <h2 className="text-lg font-semibold">
        {isEditing ? 'Edit account' : 'New account'}
      </h2>

      <div>
        <label htmlFor="account-name" className="block text-sm font-medium mb-1">
          Name
        </label>
        <input
          id="account-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700"
        />
      </div>

      <div>
        <label htmlFor="account-type" className="block text-sm font-medium mb-1">
          Type
        </label>
        <select
          id="account-type"
          value={type}
          onChange={(e) => setType(e.target.value as AccountType)}
          className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700"
        >
          {ACCOUNT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </option>
          ))}
        </select>
      </div>

      {!isEditing && (
        <div>
          <label
            htmlFor="account-opening"
            className="block text-sm font-medium mb-1"
          >
            Opening balance ($)
          </label>
          <input
            id="account-opening"
            inputMode="decimal"
            value={openingBalance}
            onChange={(e) => setOpeningBalance(e.target.value)}
            placeholder="0.00"
            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700"
          />
          {(type === 'credit' || type === 'loan') &&
            dollarsToCents(openingBalance) ? (
            <p className="text-xs text-gray-500 mt-1">
              Stored as {formatCents(-(dollarsToCents(openingBalance) as number))}{' '}
              (amount owed).
            </p>
          ) : null}
        </div>
      )}

      {error && <p className="text-red-500 text-sm">{error}</p>}

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
