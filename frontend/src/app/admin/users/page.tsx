'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { showErrorToast } from '@/lib/toast';
import type { User } from '@/lib/types';
import UserTable from '@/components/admin/UserTable';

export default function AdminUsersPage() {
  const { isAdmin, isAuthenticated } = useAuth();
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isAuthenticated && !isAdmin) {
      router.push('/');
      return;
    }
    if (!isAuthenticated) return;

    let cancelled = false;
    apiFetch<User[]>('/admin/users')
      .then((data) => {
        if (!cancelled) setUsers(data);
      })
      .catch((err) => {
        showErrorToast(err instanceof Error ? err.message : 'Failed to load users');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin, isAuthenticated, router]);

  function handleUserDeleted(id: string) {
    setUsers((prev) => prev.filter((u) => u._id !== id));
  }

  if (!isAdmin) return null;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          User Management
        </h1>
        <Link
          href="/admin/users/new"
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
        >
          + New User
        </Link>
      </div>
      {loading ? (
        <p className="text-gray-500 dark:text-gray-400">Loading users...</p>
      ) : users.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400">No users found.</p>
      ) : (
        <UserTable users={users} onUserDeleted={handleUserDeleted} />
      )}
    </div>
  );
}
