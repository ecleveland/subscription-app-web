'use client';

import { useState } from 'react';
import { removeMember } from '@/lib/households';
import { useHousehold } from '@/lib/household-context';
import { showErrorToast, showSuccessToast } from '@/lib/toast';
import type { HouseholdMember } from '@/lib/types';

function memberLabel(member: HouseholdMember): string {
  return member.userId?.displayName || member.userId?.username || 'Unknown user';
}

export default function HouseholdMembersList() {
  const { members, isOwner, refresh } = useHousehold();
  const [removingId, setRemovingId] = useState<string | null>(null);

  async function handleRemove(member: HouseholdMember) {
    if (
      !window.confirm(`Remove ${memberLabel(member)} from this household?`)
    ) {
      return;
    }
    setRemovingId(member._id);
    try {
      await removeMember(member._id);
      await refresh();
      showSuccessToast('Member removed.');
    } catch (err) {
      showErrorToast(
        err instanceof Error ? err.message : 'Failed to remove member',
      );
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div>
      <h2 className="section-title mb-4">
        Members
      </h2>
      <ul className="divide-y divide-line max-w-md">
        {members.map((member) => (
          <li
            key={member._id}
            className="flex items-center justify-between py-3"
          >
            <div>
              <p className="text-sm font-medium text-ink">
                {memberLabel(member)}
              </p>
              {member.userId?.email && (
                <p className="text-xs text-muted">
                  {member.userId.email}
                </p>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs uppercase tracking-wide text-muted">
                {member.role}
              </span>
              {isOwner && member.role !== 'owner' && (
                <button
                  type="button"
                  onClick={() => handleRemove(member)}
                  disabled={removingId === member._id}
                  className="text-sm text-danger hover:text-danger-strong disabled:opacity-50 transition-colors"
                  aria-label={`Remove ${memberLabel(member)}`}
                >
                  {removingId === member._id ? 'Removing...' : 'Remove'}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
