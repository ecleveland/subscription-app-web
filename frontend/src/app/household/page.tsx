'use client';

import HouseholdSettingsForm from '@/components/HouseholdSettingsForm';
import HouseholdMembersList from '@/components/HouseholdMembersList';
import InviteMemberForm from '@/components/InviteMemberForm';
import { useHousehold } from '@/lib/household-context';

export default function HouseholdPage() {
  const { loading, household, isOwner, error } = useHousehold();

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 md:px-8 md:py-10">
      <h1 className="page-title mb-6">
        Household
      </h1>

      {loading ? (
        <p className="text-muted">Loading household...</p>
      ) : !household ? (
        <p className="text-muted">
          {error ?? 'No household found.'}
        </p>
      ) : (
        <div className="space-y-8">
          <HouseholdSettingsForm />
          <hr className="border-line" />
          <HouseholdMembersList />
          {isOwner && (
            <>
              <hr className="border-line" />
              <InviteMemberForm />
            </>
          )}
        </div>
      )}
    </div>
  );
}
