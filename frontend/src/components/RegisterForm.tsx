'use client';

import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';

export default function RegisterForm() {
  const { register } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setLoading(true);

    try {
      await register({
        username,
        password,
        displayName: displayName || undefined,
        email: email || undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  const inputClasses =
    'w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100';

  return (
    <form onSubmit={handleSubmit} className="space-y-4 w-full max-w-sm">
      <div>
        <label htmlFor="username" className="block text-sm font-medium mb-1">
          Username
        </label>
        <input
          id="username"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          className={inputClasses}
        />
      </div>
      <div>
        <label
          htmlFor="displayName"
          className="block text-sm font-medium mb-1"
        >
          Display Name{' '}
          <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <input
          id="displayName"
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className={inputClasses}
        />
      </div>
      <div>
        <label htmlFor="email" className="block text-sm font-medium mb-1">
          Email <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClasses}
        />
      </div>
      <div>
        <label htmlFor="password" className="block text-sm font-medium mb-1">
          Password
        </label>
        <input
          id="password"
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
          htmlFor="confirmPassword"
          className="block text-sm font-medium mb-1"
        >
          Confirm Password
        </label>
        <input
          id="confirmPassword"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          minLength={8}
          className={inputClasses}
        />
      </div>
      {error && <p className="text-red-500 text-sm">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="w-full py-2 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
      >
        {loading ? 'Creating account...' : 'Create Account'}
      </button>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Already have an account?{' '}
        <Link
          href="/login"
          className="text-blue-600 hover:text-blue-700 dark:text-blue-400"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
