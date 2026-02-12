'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';

export default function AdminUserForm() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'user' | 'admin'>('user');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setLoading(true);

    try {
      await apiFetch('/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          username,
          password,
          displayName: displayName || undefined,
          email: email || undefined,
          role,
        }),
      });
      router.push('/admin/users');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setLoading(false);
    }
  }

  const inputClasses =
    'w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100';

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
      <div>
        <label
          htmlFor="admin-username"
          className="block text-sm font-medium mb-1"
        >
          Username
        </label>
        <input
          id="admin-username"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          className={inputClasses}
        />
      </div>
      <div>
        <label
          htmlFor="admin-password"
          className="block text-sm font-medium mb-1"
        >
          Password
        </label>
        <input
          id="admin-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          className={inputClasses}
        />
      </div>
      <div>
        <label
          htmlFor="admin-displayName"
          className="block text-sm font-medium mb-1"
        >
          Display Name{' '}
          <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <input
          id="admin-displayName"
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className={inputClasses}
        />
      </div>
      <div>
        <label
          htmlFor="admin-email"
          className="block text-sm font-medium mb-1"
        >
          Email <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <input
          id="admin-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClasses}
        />
      </div>
      <div>
        <label htmlFor="admin-role" className="block text-sm font-medium mb-1">
          Role
        </label>
        <select
          id="admin-role"
          value={role}
          onChange={(e) => setRole(e.target.value as 'user' | 'admin')}
          className={inputClasses}
        >
          <option value="user">User</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      {error && <p className="text-red-500 text-sm">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="py-2 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
      >
        {loading ? 'Creating...' : 'Create User'}
      </button>
    </form>
  );
}
