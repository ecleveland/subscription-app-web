'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { showErrorToast } from '@/lib/toast';
import type { User } from '@/lib/types';
import UserTable from '@/components/admin/UserTable';
import UserTableSkeleton from '@/components/admin/UserTableSkeleton';

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
    <div className="max-w-5xl mx-auto px-4 py-8 md:px-8 md:py-10">
      <div className="flex items-center justify-between mb-6">
        <h1 className="page-title">
          User Management
        </h1>
        <Link
          href="/admin/users/new"
          className="btn-primary"
        >
          + New User
        </Link>
      </div>
      {loading ? (
        <UserTableSkeleton />
      ) : users.length === 0 ? (
        <p className="text-muted">No users found.</p>
      ) : (
        <UserTable users={users} onUserDeleted={handleUserDeleted} />
      )}
    </div>
  );
}
