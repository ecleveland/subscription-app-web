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
        <p className="text-red-500">
          No invitation token found. Please use the link from your email.
        </p>
        <Link
          href="/household"
          className="text-blue-600 hover:text-blue-700 dark:text-blue-400 text-sm"
        >
          Go to your household
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm space-y-4">
      <p className="text-gray-700 dark:text-gray-300 text-sm">
        You&apos;ve been invited to join a household. Accepting will switch your
        active household to the shared one.
      </p>
      {error && <p className="text-red-500 text-sm">{error}</p>}
      <button
        type="button"
        onClick={handleAccept}
        disabled={loading}
        className="w-full py-2 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
      >
        {loading ? 'Accepting...' : 'Accept Invitation'}
      </button>
    </div>
  );
}
