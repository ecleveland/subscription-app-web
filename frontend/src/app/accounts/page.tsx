'use client';

import { useState } from 'react';
import { useAccounts } from '@/lib/accounts-context';
import { archiveAccount } from '@/lib/accounts';
import { formatCents } from '@/lib/utils';
import { showErrorToast, showSuccessToast } from '@/lib/toast';
import AccountForm from '@/components/AccountForm';
import ConfirmDialog from '@/components/ConfirmDialog';
import type { Account } from '@/lib/types';

export default function AccountsPage() {
  const { accounts, loading, error, refresh } = useAccounts();
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [archiving, setArchiving] = useState<Account | null>(null);

  async function handleArchive() {
    if (!archiving) return;
    try {
      await archiveAccount(archiving._id);
      showSuccessToast('Account archived');
      setArchiving(null);
      await refresh();
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to archive');
    }
  }

  async function handleSaved() {
    setShowCreate(false);
    setEditing(null);
    await refresh();
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8">
        <p className="text-gray-500">Loading accounts…</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Accounts</h1>
        {!showCreate && !editing && (
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            + Add account
          </button>
        )}
      </div>

      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

      {showCreate && (
        <div className="mb-6">
          <AccountForm onSaved={handleSaved} onCancel={() => setShowCreate(false)} />
        </div>
      )}

      {editing && (
        <div className="mb-6">
          <AccountForm
            account={editing}
            onSaved={handleSaved}
            onCancel={() => setEditing(null)}
          />
        </div>
      )}

      {accounts.length === 0 && !showCreate ? (
        <p className="text-gray-500 text-center py-8">
          No accounts yet. Add one to start tracking your balances.
        </p>
      ) : (
        <ul className="space-y-2">
          {accounts.map((account) => (
            <li
              key={account._id}
              className="flex items-center justify-between border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-3 bg-white dark:bg-gray-800"
            >
              <div>
                <p className="font-medium">{account.name}</p>
                <p className="text-xs text-gray-500 capitalize">{account.type}</p>
              </div>
              <div className="flex items-center gap-4">
                <span
                  className={
                    account.balanceCents < 0
                      ? 'font-semibold text-red-600'
                      : 'font-semibold'
                  }
                >
                  {formatCents(account.balanceCents)}
                </span>
                <button
                  onClick={() => {
                    setShowCreate(false);
                    setEditing(account);
                  }}
                  className="text-sm text-gray-600 dark:text-gray-300 hover:underline"
                >
                  Edit
                </button>
                <button
                  onClick={() => setArchiving(account)}
                  className="text-sm text-red-600 hover:underline"
                >
                  Archive
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={!!archiving}
        title="Archive account"
        message={`Archive "${archiving?.name}"? Its transactions are kept; you can restore it later.`}
        confirmLabel="Archive"
        onConfirm={handleArchive}
        onCancel={() => setArchiving(null)}
        destructive
      />
    </div>
  );
}
