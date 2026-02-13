'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Subscription } from '@/lib/types';
import DashboardSummary from '@/components/DashboardSummary';
import SubscriptionList from '@/components/SubscriptionList';

export default function DashboardPage() {
  const { isAuthenticated } = useAuth();
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    apiFetch<Subscription[]>('/subscriptions')
      .then((data) => {
        if (!cancelled) setSubscriptions(data);
      })
      .catch(() => {})
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

  function handleToggleActive(id: string, isActive: boolean) {
    setSubscriptions((prev) =>
      prev.map((sub) => (sub._id === id ? { ...sub, isActive } : sub)),
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <DashboardSummary subscriptions={subscriptions} />
      <SubscriptionList subscriptions={subscriptions} onToggleActive={handleToggleActive} />
    </div>
  );
}
