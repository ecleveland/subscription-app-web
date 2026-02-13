import { Subscription } from '@/lib/types';
import { formatCurrency, getMonthlyCost, getYearlyCost } from '@/lib/utils';

export default function DashboardSummary({
  subscriptions,
}: {
  subscriptions: Subscription[];
}) {
  const activeSubscriptions = subscriptions.filter(
    (sub) => sub.isActive !== false,
  );
  const totalMonthly = activeSubscriptions.reduce(
    (sum, sub) => sum + getMonthlyCost(sub.cost, sub.billingCycle),
    0,
  );
  const totalYearly = activeSubscriptions.reduce(
    (sum, sub) => sum + getYearlyCost(sub.cost, sub.billingCycle),
    0,
  );

  return (
    <div className="grid grid-cols-3 gap-4 mb-6">
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">Monthly</p>
        <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {formatCurrency(totalMonthly)}
        </p>
      </div>
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">Yearly</p>
        <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {formatCurrency(totalYearly)}
        </p>
      </div>
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">Active</p>
        <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {activeSubscriptions.length}
        </p>
      </div>
    </div>
  );
}
