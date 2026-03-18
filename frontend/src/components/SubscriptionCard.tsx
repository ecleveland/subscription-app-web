'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Subscription } from '@/lib/types';
import { apiFetch } from '@/lib/api';
import { formatCurrency, formatDate, daysUntil, getMonthlyCost } from '@/lib/utils';
import { showErrorToast } from '@/lib/toast';
import CategoryBadge from './CategoryBadge';
import TagBadge from './TagBadge';

export default function SubscriptionCard({
  subscription,
  onToggleActive,
  selectionMode,
  isSelected,
  onSelect,
}: {
  subscription: Subscription;
  onToggleActive?: (id: string, isActive: boolean) => void;
  selectionMode?: boolean;
  isSelected?: boolean;
  onSelect?: (id: string) => void;
}) {
  const [isActive, setIsActive] = useState(subscription.isActive !== false);
  const [toggling, setToggling] = useState(false);
  const days = daysUntil(subscription.nextBillingDate);
  const monthly = getMonthlyCost(subscription.cost, subscription.billingCycle);

  const trialDays = subscription.trialEndDate ? daysUntil(subscription.trialEndDate) : -1;
  const isTrialActive = trialDays > 0;
  const isTrialExpiringSoon = isTrialActive && trialDays <= 3;

  async function handleToggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (toggling) return;

    const newValue = !isActive;
    setIsActive(newValue);
    setToggling(true);

    try {
      await apiFetch(`/subscriptions/${subscription._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: newValue }),
      });
      onToggleActive?.(subscription._id, newValue);
    } catch (err) {
      setIsActive(!newValue);
      showErrorToast(err instanceof Error ? err.message : 'Failed to update subscription');
    } finally {
      setToggling(false);
    }
  }

  return (
    <Link
      href={`/subscriptions/${subscription._id}/edit`}
      onClick={selectionMode ? (e) => { e.preventDefault(); onSelect?.(subscription._id); } : undefined}
      className={`block border rounded-lg p-4 hover:shadow-sm transition-all ${
        selectionMode && isSelected
          ? 'border-blue-500 dark:border-blue-400 bg-blue-50 dark:bg-blue-900/20'
          : isTrialExpiringSoon
            ? 'border-orange-400 dark:border-orange-500 bg-orange-50 dark:bg-orange-900/20'
            : isActive
              ? 'border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-500 bg-white dark:bg-gray-800'
              : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 opacity-60'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-1 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          {selectionMode && (
            <input
              type="checkbox"
              checked={!!isSelected}
              onChange={(e) => { e.stopPropagation(); onSelect?.(subscription._id); }}
              onClick={(e) => e.stopPropagation()}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
          )}
          <h3 className={`font-semibold truncate ${isActive ? 'text-gray-900 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400'}`}>
            {subscription.name}
          </h3>
          {!isActive && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-600 text-gray-500 dark:text-gray-400">
              Inactive
            </span>
          )}
          {isTrialActive && (
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
              isTrialExpiringSoon
                ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400'
                : 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
            }`}>
              Trial
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-lg font-bold ${isActive ? 'text-gray-900 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400'}`}>
            {formatCurrency(subscription.cost)}
            <span className="text-xs text-gray-500 dark:text-gray-400 font-normal">
              /{subscription.billingCycle === 'monthly' ? 'mo' : subscription.billingCycle === 'yearly' ? 'yr' : 'wk'}
            </span>
          </span>
          <button
            onClick={handleToggle}
            disabled={toggling}
            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
              isActive ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'
            }`}
            aria-label={isActive ? 'Deactivate subscription' : 'Activate subscription'}
            title={isActive ? 'Deactivate' : 'Activate'}
          >
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                isActive ? 'translate-x-4.5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
      </div>
      <div className="flex items-center gap-2 mb-2">
        <CategoryBadge category={subscription.category} />
        {subscription.billingCycle !== 'monthly' && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            ({formatCurrency(monthly)}/mo)
          </span>
        )}
      </div>
      {subscription.tags && subscription.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {subscription.tags.map((tag) => (
            <TagBadge key={tag} tag={tag} />
          ))}
        </div>
      )}
      {isTrialActive && (
        <div className={`text-sm font-medium mb-1 ${
          isTrialExpiringSoon ? 'text-orange-600 dark:text-orange-400' : 'text-green-600 dark:text-green-400'
        }`}>
          Trial ends in {trialDays} day{trialDays === 1 ? '' : 's'}
        </div>
      )}
      <div className="text-sm text-gray-500 dark:text-gray-400">
        Next billing: {formatDate(subscription.nextBillingDate)}
        {isActive && days >= 0 && (
          <span className={days <= 3 ? ' text-red-500 font-medium' : ''}>
            {' '}
            ({days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`})
          </span>
        )}
      </div>
    </Link>
  );
}
