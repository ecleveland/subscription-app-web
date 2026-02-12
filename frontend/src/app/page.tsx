'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { Subscription } from '@/lib/types';
import DashboardSummary from '@/components/DashboardSummary';
import SubscriptionList from '@/components/SubscriptionList';

export default function DashboardPage() {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<Subscription[]>('/subscriptions')
      .then(setSubscriptions)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8">
        <p className="text-gray-500 dark:text-gray-400">Loading...</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <DashboardSummary subscriptions={subscriptions} />
      <SubscriptionList subscriptions={subscriptions} />
    </div>
  );
}
