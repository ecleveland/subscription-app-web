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
    <div className="max-w-5xl mx-auto px-4 py-8 md:px-8 md:py-10">
      <h1 className="page-title mb-6">
        Create New User
      </h1>
      <AdminUserForm />
    </div>
  );
}
