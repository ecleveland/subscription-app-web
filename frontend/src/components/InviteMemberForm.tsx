'use client';

import { useState, FormEvent } from 'react';
import { inviteMember } from '@/lib/households';
import { showErrorToast, showSuccessToast } from '@/lib/toast';
import { INVITE_ROLES, type InviteRole } from '@/lib/types';

const inputClasses =
  'input';

export default function InviteMemberForm() {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InviteRole>('adult');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [inviteUrl, setInviteUrl] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    // Drop any link from a prior invite so a failed re-invite can't leave a
    // stale link on screen that looks like it belongs to the new invitee.
    setInviteUrl('');

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
      <h2 className="section-title mb-4">
        Invite a Member
      </h2>
      <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
        <div>
          <label htmlFor="invite-email" className="label">
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
          <label htmlFor="invite-role" className="label">
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
        {error && <p className="text-danger text-sm">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="btn-primary"
        >
          {loading ? 'Sending...' : 'Send Invitation'}
        </button>
      </form>

      {inviteUrl && (
        <div className="mt-4 max-w-md">
          <label
            htmlFor="invite-link"
            className="label"
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
              className="btn-secondary whitespace-nowrap"
            >
              Copy
            </button>
          </div>
          <p className="text-xs text-muted mt-1">
            We&apos;ve emailed this link to the invitee — you can also share it
            directly.
          </p>
        </div>
      )}
    </div>
  );
}
