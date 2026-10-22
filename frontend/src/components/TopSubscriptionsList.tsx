import { useMemo } from 'react';
import { Subscription } from '@/lib/types';
import { getMonthlyCost, getPersonalShare, formatCurrency } from '@/lib/utils';
import CategoryBadge from '@/components/CategoryBadge';

export default function TopSubscriptionsList({ subscriptions }: { subscriptions: Subscription[] }) {
  const top5 = useMemo(() => {
    return subscriptions
      .filter((s) => s.isActive !== false)
      .map((sub) => ({
        ...sub,
        monthlyCost: getMonthlyCost(getPersonalShare(sub.cost, sub.sharedWith), sub.billingCycle),
      }))
      .sort((a, b) => b.monthlyCost - a.monthlyCost)
      .slice(0, 5);
  }, [subscriptions]);

  if (top5.length === 0) {
    return (
      <div className="text-center py-8 text-muted">
        No active subscriptions to display.
      </div>
    );
  }

  return (
    <ol className="space-y-3">
      {top5.map((sub, index) => (
        <li
          key={sub._id}
          className="flex items-center gap-3 bg-surface border border-line rounded-md px-4 py-3"
        >
          <span className="text-lg font-bold text-muted w-6 text-center">
            {index + 1}
          </span>
          <span className="flex-1 font-medium text-ink">
            {sub.name}
          </span>
          <CategoryBadge category={sub.category} />
          <span className="font-semibold text-ink">
            {formatCurrency(sub.monthlyCost)}/mo
          </span>
        </li>
      ))}
    </ol>
  );
}
