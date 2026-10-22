'use client';

import ProfileForm from '@/components/ProfileForm';
import ChangePasswordForm from '@/components/ChangePasswordForm';

export default function ProfilePage() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-8 md:px-8 md:py-10">
      <h1 className="page-title mb-6">
        Profile
      </h1>
      <div className="space-y-8">
        <ProfileForm />
        <hr className="border-line" />
        <ChangePasswordForm />
      </div>
    </div>
  );
}
