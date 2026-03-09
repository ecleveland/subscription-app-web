'use client';

import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { showErrorToast } from '@/lib/toast';

export default function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      await apiFetch('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      setSubmitted(true);
    } catch (err) {
      showErrorToast(
        err instanceof Error ? err.message : 'Something went wrong',
      );
    } finally {
      setLoading(false);
    }
  }

  const inputClasses =
    'w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100';

  if (submitted) {
    return (
      <div className="w-full max-w-sm space-y-4">
        <p className="text-gray-700 dark:text-gray-300">
          If an account with that email exists, a reset link has been sent.
        </p>
        <Link
          href="/login"
          className="text-blue-600 hover:text-blue-700 dark:text-blue-400 text-sm"
        >
          Back to login
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 w-full max-w-sm">
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Enter your email and we&apos;ll send you a link to reset your password.
      </p>
      <div>
        <label htmlFor="email" className="block text-sm font-medium mb-1">
          Email
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className={inputClasses}
          placeholder="you@example.com"
        />
      </div>
      <button
        type="submit"
        disabled={loading}
        className="w-full py-2 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
      >
        {loading ? 'Sending...' : 'Send Reset Link'}
      </button>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        <Link
          href="/login"
          className="text-blue-600 hover:text-blue-700 dark:text-blue-400"
        >
          Back to login
        </Link>
      </p>
    </form>
  );
}
