import { useMemo } from 'react';
import { Subscription } from '@/lib/types';
import { getMonthlyCost, formatCurrency } from '@/lib/utils';
import CategoryBadge from '@/components/CategoryBadge';

export default function TopSubscriptionsList({ subscriptions }: { subscriptions: Subscription[] }) {
  const top5 = useMemo(() => {
    return subscriptions
      .filter((s) => s.isActive !== false)
      .map((sub) => ({
        ...sub,
        monthlyCost: getMonthlyCost(sub.cost, sub.billingCycle),
      }))
      .sort((a, b) => b.monthlyCost - a.monthlyCost)
      .slice(0, 5);
  }, [subscriptions]);

  if (top5.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500 dark:text-gray-400">
        No active subscriptions to display.
      </div>
    );
  }

  return (
    <ol className="space-y-3">
      {top5.map((sub, index) => (
        <li
          key={sub._id}
          className="flex items-center gap-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-3"
        >
          <span className="text-lg font-bold text-gray-400 dark:text-gray-500 w-6 text-center">
            {index + 1}
          </span>
          <span className="flex-1 font-medium text-gray-900 dark:text-gray-100">
            {sub.name}
          </span>
          <CategoryBadge category={sub.category} />
          <span className="font-semibold text-gray-900 dark:text-gray-100">
            {formatCurrency(sub.monthlyCost)}/mo
          </span>
        </li>
      ))}
    </ol>
  );
}
