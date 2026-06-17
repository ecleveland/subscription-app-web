'use client';

import { useState, FormEvent } from 'react';
import { inviteMember } from '@/lib/households';
import { showErrorToast, showSuccessToast } from '@/lib/toast';
import { INVITE_ROLES, type InviteRole } from '@/lib/types';

const inputClasses =
  'w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100';

export default function InviteMemberForm() {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InviteRole>('adult');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [inviteUrl, setInviteUrl] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (!email.trim()) {
      setError('Email is required.');
      return;
    }

    setLoading(true);
    try {
      const result = await inviteMember({ email: email.trim(), role });
      setInviteUrl(result.inviteUrl);
      setEmail('');
      showSuccessToast(`Invitation sent to ${result.email}.`);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to send invitation';
      setError(message);
      showErrorToast(message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      showSuccessToast('Invite link copied.');
    } catch {
      showErrorToast('Could not copy the link.');
    }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
        Invite a Member
      </h2>
      <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
        <div>
          <label htmlFor="invite-email" className="block text-sm font-medium mb-1">
            Email
          </label>
          <input
            id="invite-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClasses}
            placeholder="person@example.com"
          />
        </div>
        <div>
          <label htmlFor="invite-role" className="block text-sm font-medium mb-1">
            Role
          </label>
          <select
            id="invite-role"
            value={role}
            onChange={(e) => setRole(e.target.value as InviteRole)}
            className={inputClasses}
          >
            {INVITE_ROLES.map((r) => (
              <option key={r} value={r}>
                {r.charAt(0).toUpperCase() + r.slice(1)}
              </option>
            ))}
          </select>
        </div>
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="py-2 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
        >
          {loading ? 'Sending...' : 'Send Invitation'}
        </button>
      </form>

      {inviteUrl && (
        <div className="mt-4 max-w-md">
          <label
            htmlFor="invite-link"
            className="block text-sm font-medium mb-1"
          >
            Invite link
          </label>
          <div className="flex gap-2">
            <input
              id="invite-link"
              type="text"
              value={inviteUrl}
              readOnly
              className={inputClasses}
            />
            <button
              type="button"
              onClick={handleCopy}
              className="py-2 px-4 border border-gray-300 dark:border-gray-600 rounded-lg text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors whitespace-nowrap"
            >
              Copy
            </button>
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            We emailed this link to the invitee. You can also share it directly.
          </p>
        </div>
      )}
    </div>
  );
}
