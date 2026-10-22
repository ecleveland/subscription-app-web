'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Subscription } from '@/lib/types';
import { apiFetch } from '@/lib/api';
import { formatCurrency, formatDate, daysUntil, getMonthlyCost, getPersonalShare } from '@/lib/utils';
import { showErrorToast } from '@/lib/toast';
import CategoryBadge from './CategoryBadge';
import TagBadge from './TagBadge';

const CYCLE_SUFFIX: Record<string, string> = { monthly: 'mo', yearly: 'yr', weekly: 'wk' };

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
  const personalCost = getPersonalShare(subscription.cost, subscription.sharedWith);
  const monthly = getMonthlyCost(personalCost, subscription.billingCycle);
  const isShared = subscription.sharedWith != null && subscription.sharedWith >= 2;
  const suffix = CYCLE_SUFFIX[subscription.billingCycle] ?? 'wk';

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

  const frame = selectionMode && isSelected
    ? 'border-accent bg-accent-soft'
    : isTrialExpiringSoon
      ? 'border-warn bg-warn-soft'
      : isActive
        ? 'border-line bg-surface hover:border-line-strong'
        : 'border-line bg-surface-2 opacity-60';

  return (
    <Link
      href={`/subscriptions/${subscription._id}/edit`}
      onClick={selectionMode ? (e) => { e.preventDefault(); onSelect?.(subscription._id); } : undefined}
      className={`block rounded-md border p-4 transition-colors ${frame}`}
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {selectionMode && (
            <input
              type="checkbox"
              checked={!!isSelected}
              onChange={(e) => { e.stopPropagation(); onSelect?.(subscription._id); }}
              onClick={(e) => e.stopPropagation()}
              className="h-4 w-4 rounded border-line-strong text-accent focus:ring-accent/30"
            />
          )}
          <h3 className={`truncate text-base font-semibold ${isActive ? 'text-ink' : 'text-muted'}`}>
            {subscription.name}
          </h3>
          {!isActive && (
            <span className="rounded-sm bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted">
              Inactive
            </span>
          )}
          {isTrialActive && (
            <span className={`rounded-sm px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ${
              isTrialExpiringSoon ? 'bg-warn-soft text-warn' : 'bg-accent-soft text-accent'
            }`}>
              Trial
            </span>
          )}
          {isShared && (
            <span className="rounded-sm bg-info-soft px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-info">
              Split {subscription.sharedWith} ways
            </span>
          )}
          {subscription.accountId && (
            <span className="rounded-sm bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-accent">
              In ledger
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className={`num text-lg font-medium ${isActive ? 'text-ink' : 'text-muted'}`}>
            {formatCurrency(subscription.cost)}
            <span className="font-sans text-xs font-normal text-muted">
              /{suffix}
            </span>
          </span>
          <button
            onClick={handleToggle}
            disabled={toggling}
            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
              isActive ? 'bg-accent' : 'bg-line-strong'
            }`}
            aria-label={isActive ? 'Deactivate subscription' : 'Activate subscription'}
            title={isActive ? 'Deactivate' : 'Activate'}
          >
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full bg-surface transition-transform ${
                isActive ? 'translate-x-4.5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
      </div>
      {isShared && (
        <div className="num mb-1 text-sm text-info">
          Your share: {formatCurrency(personalCost)}/{suffix}
        </div>
      )}
      <div className="mb-2 flex items-center gap-2">
        <CategoryBadge category={subscription.category} />
        {subscription.billingCycle !== 'monthly' && (
          <span className="num text-xs text-muted">
            ({formatCurrency(monthly)}/mo)
          </span>
        )}
      </div>
      {subscription.tags && subscription.tags.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {subscription.tags.map((tag) => (
            <TagBadge key={tag} tag={tag} />
          ))}
        </div>
      )}
      {isTrialActive && (
        <div className={`mb-1 text-sm font-medium ${isTrialExpiringSoon ? 'text-warn' : 'text-accent'}`}>
          Trial ends in {trialDays} day{trialDays === 1 ? '' : 's'}
        </div>
      )}
      <div className="text-sm text-muted">
        Next billing: {formatDate(subscription.nextBillingDate)}
        {isActive && days >= 0 && (
          <span className={days <= 3 ? ' font-medium text-danger' : ''}>
            {' '}
            ({days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`})
          </span>
        )}
      </div>
    </Link>
  );
}
