'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { showErrorToast } from '@/lib/toast';
import { Subscription, PaginatedResponse } from '@/lib/types';
import CalendarView from '@/components/CalendarView';

export default function CalendarPage() {
  const { isAuthenticated } = useAuth();
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    apiFetch<PaginatedResponse<Subscription>>('/subscriptions?limit=0')
      .then((res) => {
        if (!cancelled) setSubscriptions(res.data);
      })
      .catch((err) => {
        showErrorToast(err instanceof Error ? err.message : 'Failed to load subscriptions');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8">
        <p className="text-gray-500 dark:text-gray-400">Loading...</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-8">
        Billing Calendar
      </h1>
      <CalendarView subscriptions={subscriptions} />
    </div>
  );
}
