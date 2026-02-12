'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import AdminUserForm from '@/components/admin/AdminUserForm';

export default function NewUserPage() {
  const { isAdmin, isAuthenticated } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isAuthenticated && !isAdmin) {
      router.push('/');
    }
  }, [isAdmin, isAuthenticated, router]);

  if (!isAdmin) return null;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">
        Create New User
      </h1>
      <AdminUserForm />
    </div>
  );
}
