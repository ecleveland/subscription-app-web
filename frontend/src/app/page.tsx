'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { showErrorToast } from '@/lib/toast';
import { Subscription, PaginatedResponse, PaginationMeta } from '@/lib/types';
import DashboardSummary from '@/components/DashboardSummary';
import SubscriptionList from '@/components/SubscriptionList';
import Pagination from '@/components/Pagination';

const SORT_OPTIONS = [
  { key: 'nextBillingDate-asc', label: 'Next billing date' },
  { key: 'name-asc', label: 'Name (A–Z)' },
  { key: 'cost-asc', label: 'Monthly cost (low to high)' },
  { key: 'cost-desc', label: 'Monthly cost (high to low)' },
  { key: 'createdAt-desc', label: 'Date added (newest)' },
];

export default function DashboardPage() {
  const { isAuthenticated } = useAuth();
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [allSubscriptions, setAllSubscriptions] = useState<Subscription[]>([]);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState('nextBillingDate-asc');
  const [page, setPage] = useState(1);

  // Reset page to 1 when sort changes
  useEffect(() => {
    setPage(1);
  }, [sortKey]);

  // Paginated fetch for the list
  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    const [sortBy, sortOrder] = sortKey.split('-');
    apiFetch<PaginatedResponse<Subscription>>(
      `/subscriptions?sortBy=${sortBy}&sortOrder=${sortOrder}&page=${page}&limit=20`,
    )
      .then((res) => {
        if (!cancelled) {
          setSubscriptions(res.data);
          setMeta(res.meta);
        }
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
  }, [isAuthenticated, sortKey, page]);

  // Unpaginated fetch for summary (all subscriptions)
  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    apiFetch<PaginatedResponse<Subscription>>('/subscriptions?limit=0')
      .then((res) => {
        if (!cancelled) setAllSubscriptions(res.data);
      })
      .catch((err) => {
        showErrorToast(err instanceof Error ? err.message : 'Failed to load subscriptions');
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
    setAllSubscriptions((prev) =>
      prev.map((sub) => (sub._id === id ? { ...sub, isActive } : sub)),
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <DashboardSummary subscriptions={allSubscriptions} />
      <div className="flex items-center gap-2 mb-4">
        <label htmlFor="sort" className="text-sm text-gray-500 dark:text-gray-400">Sort by</label>
        <select
          id="sort"
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value)}
          className="flex-1 sm:flex-initial px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.key} value={opt.key}>{opt.label}</option>
          ))}
        </select>
      </div>
      <SubscriptionList subscriptions={subscriptions} onToggleActive={handleToggleActive} />
      {meta && meta.totalPages > 1 && (
        <Pagination page={page} totalPages={meta.totalPages} onPageChange={setPage} />
      )}
    </div>
  );
}
