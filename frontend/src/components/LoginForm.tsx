'use client';

import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { withRedirect } from '@/lib/safe-redirect';

export default function LoginForm() {
  const { login } = useAuth();
  const redirectTo = useSearchParams().get('redirect');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(username, password, redirectTo);
    } catch {
      setError('Invalid credentials. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const inputClasses =
    'input';

  return (
    <form onSubmit={handleSubmit} className="space-y-4 w-full max-w-sm">
      <div>
        <label htmlFor="username" className="label">
          Username
        </label>
        <input
          id="username"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          className={inputClasses}
          placeholder="admin"
        />
      </div>
      <div>
        <label htmlFor="password" className="label">
          Password
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className={inputClasses}
        />
      </div>
      <div className="text-right">
        <Link
          href={withRedirect('/forgot-password', redirectTo)}
          className="text-sm text-accent hover:text-accent-strong"
        >
          Forgot password?
        </Link>
      </div>
      {error && (
        <p className="text-danger text-sm">{error}</p>
      )}
      <button
        type="submit"
        disabled={loading}
        className="w-full btn-primary"
      >
        {loading ? 'Signing in...' : 'Sign In'}
      </button>
      <p className="text-sm text-muted">
        Don&apos;t have an account?{' '}
        <Link
          href={withRedirect('/register', redirectTo)}
          className="text-accent hover:text-accent-strong"
        >
          Create one
        </Link>
      </p>
    </form>
  );
}
