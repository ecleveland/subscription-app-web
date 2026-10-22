'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { showErrorToast, showSuccessToast } from '@/lib/toast';

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
      showSuccessToast('User created');
      router.push('/admin/users');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create user';
      setError(message);
      showErrorToast(message);
    } finally {
      setLoading(false);
    }
  }

  const inputClasses =
    'input';

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
      <div>
        <label
          htmlFor="admin-username"
          className="label"
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
          className="label"
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
          className="label"
        >
          Display Name{' '}
          <span className="text-muted font-normal">(optional)</span>
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
          className="label"
        >
          Email <span className="text-muted font-normal">(optional)</span>
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
        <label htmlFor="admin-role" className="label">
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
      {error && <p className="text-danger text-sm">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="btn-primary"
      >
        {loading ? 'Creating...' : 'Create User'}
      </button>
    </form>
  );
}
