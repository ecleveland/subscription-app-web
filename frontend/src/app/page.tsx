'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { showErrorToast, showSuccessToast } from '@/lib/toast';
import { Subscription, PaginatedResponse, PaginationMeta, BulkAction, BulkOperationResult } from '@/lib/types';
import DashboardSummary from '@/components/DashboardSummary';
import SearchInput from '@/components/SearchInput';
import SubscriptionList from '@/components/SubscriptionList';
import Pagination from '@/components/Pagination';
import DashboardSkeleton from '@/components/DashboardSkeleton';
import BulkActionToolbar from '@/components/BulkActionToolbar';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useDebounce } from '@/hooks/useDebounce';

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
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearch = useDebounce(searchTerm, 300);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ action: BulkAction; category?: string } | null>(null);

  function handleSortChange(newSortKey: string) {
    setSortKey(newSortKey);
    setPage(1);
  }

  function handleSearchChange(value: string) {
    setSearchTerm(value);
    setPage(1);
  }

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

  function handleToggleActive(id: string, isActive: boolean) {
    setSubscriptions((prev) =>
      prev.map((sub) => (sub._id === id ? { ...sub, isActive } : sub)),
    );
    setAllSubscriptions((prev) =>
      prev.map((sub) => (sub._id === id ? { ...sub, isActive } : sub)),
    );
  }

  function handleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSelectAll() {
    setSelectedIds(new Set(displaySubscriptions.map((s) => s._id)));
  }

  function handleDeselectAll() {
    setSelectedIds(new Set());
  }

  function exitSelectionMode() {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }

  async function handleBulkAction(action: BulkAction, category?: string) {
    setConfirmAction(null);
    setBulkLoading(true);
    try {
      const result = await apiFetch<BulkOperationResult>('/subscriptions/bulk', {
        method: 'POST',
        body: JSON.stringify({ ids: Array.from(selectedIds), action, category }),
      });

      if (action === 'delete') {
        setSubscriptions((prev) => prev.filter((s) => !selectedIds.has(s._id)));
        setAllSubscriptions((prev) => prev.filter((s) => !selectedIds.has(s._id)));
      } else if (action === 'activate') {
        setSubscriptions((prev) => prev.map((s) => selectedIds.has(s._id) ? { ...s, isActive: true } : s));
        setAllSubscriptions((prev) => prev.map((s) => selectedIds.has(s._id) ? { ...s, isActive: true } : s));
      } else if (action === 'deactivate') {
        setSubscriptions((prev) => prev.map((s) => selectedIds.has(s._id) ? { ...s, isActive: false } : s));
        setAllSubscriptions((prev) => prev.map((s) => selectedIds.has(s._id) ? { ...s, isActive: false } : s));
      } else if (action === 'changeCategory' && category) {
        setSubscriptions((prev) => prev.map((s) => selectedIds.has(s._id) ? { ...s, category } : s));
        setAllSubscriptions((prev) => prev.map((s) => selectedIds.has(s._id) ? { ...s, category } : s));
      }

      showSuccessToast(`${result.success} subscription${result.success === 1 ? '' : 's'} updated`);
      setSelectedIds(new Set());

      if (result.failed > 0) {
        // Refetch if some operations failed
        const [sortBy, sortOrder] = sortKey.split('-');
        const res = await apiFetch<PaginatedResponse<Subscription>>(
          `/subscriptions?sortBy=${sortBy}&sortOrder=${sortOrder}&page=${page}&limit=20`,
        );
        setSubscriptions(res.data);
        setMeta(res.meta);
        const allRes = await apiFetch<PaginatedResponse<Subscription>>('/subscriptions?limit=0');
        setAllSubscriptions(allRes.data);
      }
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Bulk operation failed');
    } finally {
      setBulkLoading(false);
    }
  }

  const isSearching = debouncedSearch.trim().length > 0;

  const { displaySubscriptions, displayMeta } = useMemo(() => {
    if (!isSearching) {
      return { displaySubscriptions: subscriptions, displayMeta: meta };
    }

    const query = debouncedSearch.trim().toLowerCase();
    const filtered = allSubscriptions.filter(
      (sub) =>
        sub.name.toLowerCase().includes(query) ||
        (sub.notes && sub.notes.toLowerCase().includes(query)),
    );

    const [sortBy, sortOrder] = sortKey.split('-');
    const sorted = [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'cost':
          cmp = a.cost - b.cost;
          break;
        case 'nextBillingDate':
          cmp = new Date(a.nextBillingDate).getTime() - new Date(b.nextBillingDate).getTime();
          break;
        case 'createdAt':
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
      }
      return sortOrder === 'desc' ? -cmp : cmp;
    });

    const limit = 20;
    const start = (page - 1) * limit;
    const paged = sorted.slice(start, start + limit);
    const totalPages = Math.max(1, Math.ceil(sorted.length / limit));

    return {
      displaySubscriptions: paged,
      displayMeta: {
        total: sorted.length,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
      } as PaginationMeta,
    };
  }, [isSearching, debouncedSearch, allSubscriptions, subscriptions, meta, sortKey, page]);

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8">
        <DashboardSkeleton />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <DashboardSummary subscriptions={allSubscriptions} />
      <SearchInput value={searchTerm} onChange={handleSearchChange} />
      <div className="flex items-center gap-2 mb-4">
        <label htmlFor="sort" className="text-sm text-gray-500 dark:text-gray-400">Sort by</label>
        <select
          id="sort"
          value={sortKey}
          onChange={(e) => handleSortChange(e.target.value)}
          className="flex-1 sm:flex-initial px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.key} value={opt.key}>{opt.label}</option>
          ))}
        </select>
        <button
          onClick={selectionMode ? exitSelectionMode : () => setSelectionMode(true)}
          className={`px-3 py-2 text-sm rounded-lg border ${
            selectionMode
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
              : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
          }`}
        >
          {selectionMode ? 'Cancel' : 'Select'}
        </button>
      </div>
      {selectionMode && selectedIds.size > 0 && (
        <BulkActionToolbar
          selectedCount={selectedIds.size}
          totalCount={displaySubscriptions.length}
          onSelectAll={handleSelectAll}
          onDeselectAll={handleDeselectAll}
          onBulkDelete={() => setConfirmAction({ action: 'delete' })}
          onBulkActivate={() => handleBulkAction('activate')}
          onBulkDeactivate={() => handleBulkAction('deactivate')}
          onBulkChangeCategory={(category) => handleBulkAction('changeCategory', category)}
          loading={bulkLoading}
        />
      )}
      {isSearching && displaySubscriptions.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400 text-center py-8">
          No subscriptions match &ldquo;{debouncedSearch.trim()}&rdquo;
        </p>
      ) : (
        <SubscriptionList
          subscriptions={displaySubscriptions}
          onToggleActive={handleToggleActive}
          selectionMode={selectionMode}
          selectedIds={selectedIds}
          onSelect={handleSelect}
        />
      )}
      {displayMeta && displayMeta.totalPages > 1 && (
        <Pagination page={page} totalPages={displayMeta.totalPages} onPageChange={setPage} />
      )}
      <ConfirmDialog
        open={!!confirmAction}
        title="Delete subscriptions"
        message={`Are you sure you want to delete ${selectedIds.size} subscription${selectedIds.size === 1 ? '' : 's'}? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={() => confirmAction && handleBulkAction(confirmAction.action, confirmAction.category)}
        onCancel={() => setConfirmAction(null)}
        destructive
      />
    </div>
  );
}
