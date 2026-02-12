import { Subscription } from '@/lib/types';
import { formatCurrency, getMonthlyCost, getYearlyCost } from '@/lib/utils';

export default function DashboardSummary({
  subscriptions,
}: {
  subscriptions: Subscription[];
}) {
  const totalMonthly = subscriptions.reduce(
    (sum, sub) => sum + getMonthlyCost(sub.cost, sub.billingCycle),
    0,
  );
  const totalYearly = subscriptions.reduce(
    (sum, sub) => sum + getYearlyCost(sub.cost, sub.billingCycle),
    0,
  );

  return (
    <div className="grid grid-cols-3 gap-4 mb-6">
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <p className="text-sm text-gray-500">Monthly</p>
        <p className="text-2xl font-bold text-gray-900">
          {formatCurrency(totalMonthly)}
        </p>
      </div>
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <p className="text-sm text-gray-500">Yearly</p>
        <p className="text-2xl font-bold text-gray-900">
          {formatCurrency(totalYearly)}
        </p>
      </div>
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <p className="text-sm text-gray-500">Active</p>
        <p className="text-2xl font-bold text-gray-900">
          {subscriptions.length}
        </p>
      </div>
    </div>
  );
}
