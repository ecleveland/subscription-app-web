'use client';

import { useState, useEffect, FormEvent } from 'react';
import Image from 'next/image';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { showErrorToast, showSuccessToast } from '@/lib/toast';

export default function ProfileForm() {
  const { user, refreshProfile } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName ?? '');
      setEmail(user.email ?? '');
      setAvatarUrl(user.avatarUrl ?? '');
    }
  }, [user]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await apiFetch('/users/me', {
        method: 'PATCH',
        body: JSON.stringify({
          displayName: displayName || undefined,
          email: email || undefined,
          avatarUrl: avatarUrl || undefined,
        }),
      });
      await refreshProfile();
      showSuccessToast('Profile updated successfully.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update profile';
      setError(message);
      showErrorToast(message);
    } finally {
      setLoading(false);
    }
  }

  const inputClasses =
    'w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100';

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
        Profile Information
      </h2>
      {avatarUrl && (
        <div className="mb-4">
          <Image
            src={avatarUrl}
            alt="Avatar"
            width={80}
            height={80}
            className="rounded-full object-cover border-2 border-gray-200 dark:border-gray-600"
            unoptimized
          />
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
        <div>
          <label
            htmlFor="profile-username"
            className="block text-sm font-medium mb-1"
          >
            Username
          </label>
          <input
            id="profile-username"
            type="text"
            value={user?.username ?? ''}
            disabled
            className={`${inputClasses} opacity-50 cursor-not-allowed`}
          />
        </div>
        <div>
          <label
            htmlFor="profile-displayName"
            className="block text-sm font-medium mb-1"
          >
            Display Name
          </label>
          <input
            id="profile-displayName"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className={inputClasses}
          />
        </div>
        <div>
          <label
            htmlFor="profile-email"
            className="block text-sm font-medium mb-1"
          >
            Email
          </label>
          <input
            id="profile-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClasses}
          />
        </div>
        <div>
          <label
            htmlFor="profile-avatarUrl"
            className="block text-sm font-medium mb-1"
          >
            Avatar URL
          </label>
          <input
            id="profile-avatarUrl"
            type="url"
            value={avatarUrl}
            onChange={(e) => setAvatarUrl(e.target.value)}
            className={inputClasses}
            placeholder="https://example.com/avatar.jpg"
          />
        </div>
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="py-2 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
        >
          {loading ? 'Saving...' : 'Save Changes'}
        </button>
      </form>
    </div>
  );
}
