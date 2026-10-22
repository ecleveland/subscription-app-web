'use client';

import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { withRedirect } from '@/lib/safe-redirect';
import { showErrorToast } from '@/lib/toast';

export default function ForgotPasswordForm() {
  const redirectTo = useSearchParams().get('redirect');
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
    'input';

  if (submitted) {
    return (
      <div className="w-full max-w-sm space-y-4">
        <p className="text-ink-2">
          If an account with that email exists, a reset link has been sent.
        </p>
        <Link
          href={withRedirect('/login', redirectTo)}
          className="text-accent hover:text-accent-strong text-sm"
        >
          Back to login
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 w-full max-w-sm">
      <p className="text-sm text-muted">
        Enter your email and we&apos;ll send you a link to reset your password.
      </p>
      <div>
        <label htmlFor="email" className="label">
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
        className="w-full btn-primary"
      >
        {loading ? 'Sending...' : 'Send Reset Link'}
      </button>
      <p className="text-sm text-muted">
        <Link
          href={withRedirect('/login', redirectTo)}
          className="text-accent hover:text-accent-strong"
        >
          Back to login
        </Link>
      </p>
    </form>
  );
}
