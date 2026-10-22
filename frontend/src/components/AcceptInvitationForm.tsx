'use client';

import { useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { acceptInvitation } from '@/lib/households';
import { useHousehold } from '@/lib/household-context';
import { showErrorToast, showSuccessToast } from '@/lib/toast';

export default function AcceptInvitationForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const router = useRouter();
  const { refresh } = useHousehold();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleAccept() {
    if (!token) return;
    setError('');
    setLoading(true);
    try {
      await acceptInvitation(token);
      await refresh();
      showSuccessToast('You have joined the household.');
      router.push('/household');
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to accept invitation';
      setError(message);
      showErrorToast(message);
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="w-full max-w-sm space-y-4">
        <p className="text-danger">
          No invitation token found. Please use the link from your email.
        </p>
        <Link
          href="/household"
          className="text-accent hover:text-accent-strong text-sm"
        >
          Go to your household
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm space-y-4">
      <p className="text-ink-2 text-sm">
        You&apos;ve been invited to join a household. Accepting will switch your
        active household to the shared one.
      </p>
      {error && <p className="text-danger text-sm">{error}</p>}
      <button
        type="button"
        onClick={handleAccept}
        disabled={loading}
        className="w-full btn-primary"
      >
        {loading ? 'Accepting...' : 'Accept Invitation'}
      </button>
    </div>
  );
}
