'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import type { User } from '@/lib/types';
import { formatDate } from '@/lib/utils';
import { showErrorToast, showSuccessToast } from '@/lib/toast';

interface UserTableProps {
  users: User[];
  onUserDeleted: (id: string) => void;
}

export default function UserTable({ users, onUserDeleted }: UserTableProps) {
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function handleDelete(user: User) {
    if (
      !confirm(
        `Are you sure you want to delete user "${user.username}"? This cannot be undone.`,
      )
    ) {
      return;
    }

    setDeleting(user._id);
    setError('');

    try {
      await apiFetch(`/admin/users/${user._id}`, { method: 'DELETE' });
      onUserDeleted(user._id);
      showSuccessToast(`User "${user.username}" deleted`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete user';
      setError(message);
      showErrorToast(message);
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div>
      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
      {/* Mobile card view */}
      <div className="md:hidden space-y-3">
        {users.map((user) => (
          <div
            key={user._id}
            className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium text-gray-900 dark:text-gray-100">
                {user.username}
              </span>
              <span
                className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                  user.role === 'admin'
                    ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
                    : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'
                }`}
              >
                {user.role}
              </span>
            </div>
            {user.displayName && (
              <p className="text-sm text-gray-600 dark:text-gray-300">{user.displayName}</p>
            )}
            {user.email && (
              <p className="text-sm text-gray-600 dark:text-gray-300">{user.email}</p>
            )}
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
              <span className="text-xs text-gray-500 dark:text-gray-400">
                Created {formatDate(user.createdAt)}
              </span>
              <button
                onClick={() => handleDelete(user)}
                disabled={deleting === user._id}
                className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 text-sm disabled:opacity-50"
              >
                {deleting === user._id ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        ))}
      </div>
      {/* Desktop table view */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs uppercase bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
            <tr>
              <th className="px-4 py-3">Username</th>
              <th className="px-4 py-3">Display Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {users.map((user) => (
              <tr
                key={user._id}
                className="bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-750"
              >
                <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">
                  {user.username}
                </td>
                <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                  {user.displayName || '-'}
                </td>
                <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                  {user.email || '-'}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                      user.role === 'admin'
                        ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
                        : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'
                    }`}
                  >
                    {user.role}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                  {formatDate(user.createdAt)}
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => handleDelete(user)}
                    disabled={deleting === user._id}
                    className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 text-sm disabled:opacity-50"
                  >
                    {deleting === user._id ? 'Deleting...' : 'Delete'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
