'use client';

import { useState, FormEvent } from 'react';
import { apiFetch } from '@/lib/api';

export default function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.');
      return;
    }

    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }

    setLoading(true);

    try {
      await apiFetch('/users/me/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setSuccess('Password changed successfully.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to change password',
      );
    } finally {
      setLoading(false);
    }
  }

  const inputClasses =
    'w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100';

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
        Change Password
      </h2>
      <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
        <div>
          <label
            htmlFor="currentPassword"
            className="block text-sm font-medium mb-1"
          >
            Current Password
          </label>
          <input
            id="currentPassword"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            className={inputClasses}
          />
        </div>
        <div>
          <label
            htmlFor="newPassword"
            className="block text-sm font-medium mb-1"
          >
            New Password
          </label>
          <input
            id="newPassword"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={8}
            className={inputClasses}
          />
        </div>
        <div>
          <label
            htmlFor="confirmNewPassword"
            className="block text-sm font-medium mb-1"
          >
            Confirm New Password
          </label>
          <input
            id="confirmNewPassword"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={8}
            className={inputClasses}
          />
        </div>
        {error && <p className="text-red-500 text-sm">{error}</p>}
        {success && (
          <p className="text-green-600 dark:text-green-400 text-sm">
            {success}
          </p>
        )}
        <button
          type="submit"
          disabled={loading}
          className="py-2 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
        >
          {loading ? 'Changing...' : 'Change Password'}
        </button>
      </form>
    </div>
  );
}
