'use client';

import HouseholdSettingsForm from '@/components/HouseholdSettingsForm';
import HouseholdMembersList from '@/components/HouseholdMembersList';
import InviteMemberForm from '@/components/InviteMemberForm';
import { useHousehold } from '@/lib/household-context';

export default function HouseholdPage() {
  const { loading, household, isOwner, error } = useHousehold();

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">
        Household
      </h1>

      {loading ? (
        <p className="text-gray-500 dark:text-gray-400">Loading household...</p>
      ) : !household ? (
        <p className="text-gray-500 dark:text-gray-400">
          {error ?? 'No household found.'}
        </p>
      ) : (
        <div className="space-y-8">
          <HouseholdSettingsForm />
          <hr className="border-gray-200 dark:border-gray-700" />
          <HouseholdMembersList />
          {isOwner && (
            <>
              <hr className="border-gray-200 dark:border-gray-700" />
              <InviteMemberForm />
            </>
          )}
        </div>
      )}
    </div>
  );
}
