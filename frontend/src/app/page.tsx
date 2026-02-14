'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Subscription } from '@/lib/types';
import DashboardSummary from '@/components/DashboardSummary';
import SubscriptionList from '@/components/SubscriptionList';

const SORT_OPTIONS = [
  { key: 'nextBillingDate-asc', label: 'Next billing date' },
  { key: 'name-asc', label: 'Name (A–Z)' },
  { key: 'cost-asc', label: 'Cost (low to high)' },
  { key: 'cost-desc', label: 'Cost (high to low)' },
  { key: 'createdAt-desc', label: 'Date added (newest)' },
];

export default function DashboardPage() {
  const { isAuthenticated } = useAuth();
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState('nextBillingDate-asc');

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    const [sortBy, sortOrder] = sortKey.split('-');
    apiFetch<Subscription[]>(`/subscriptions?sortBy=${sortBy}&sortOrder=${sortOrder}`)
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
  }, [isAuthenticated, sortKey]);

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
      <div className="flex items-center gap-2 mb-4">
        <label htmlFor="sort" className="text-sm text-gray-500 dark:text-gray-400">Sort by</label>
        <select
          id="sort"
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value)}
          className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.key} value={opt.key}>{opt.label}</option>
          ))}
        </select>
      </div>
      <SubscriptionList subscriptions={subscriptions} onToggleActive={handleToggleActive} />
    </div>
  );
}
