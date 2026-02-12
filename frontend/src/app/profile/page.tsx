'use client';

import ProfileForm from '@/components/ProfileForm';
import ChangePasswordForm from '@/components/ChangePasswordForm';

export default function ProfilePage() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">
        Profile
      </h1>
      <div className="space-y-8">
        <ProfileForm />
        <hr className="border-gray-200 dark:border-gray-700" />
        <ChangePasswordForm />
      </div>
    </div>
  );
}
