import { Subscription } from '@/lib/types';
import {
  formatCurrency,
  getDailyCost,
  getWeeklyCost,
  getMonthlyCost,
  getYearlyCost,
  daysUntil,
} from '@/lib/utils';

export default function DashboardSummary({
  subscriptions,
}: {
  subscriptions: Subscription[];
}) {
  const activeSubscriptions = subscriptions.filter(
    (sub) => sub.isActive !== false,
  );
  const inactiveCount = subscriptions.length - activeSubscriptions.length;

  const totalDaily = activeSubscriptions.reduce(
    (sum, sub) => sum + getDailyCost(sub.cost, sub.billingCycle),
    0,
  );
  const totalWeekly = activeSubscriptions.reduce(
    (sum, sub) => sum + getWeeklyCost(sub.cost, sub.billingCycle),
    0,
  );
  const totalMonthly = activeSubscriptions.reduce(
    (sum, sub) => sum + getMonthlyCost(sub.cost, sub.billingCycle),
    0,
  );
  const totalYearly = activeSubscriptions.reduce(
    (sum, sub) => sum + getYearlyCost(sub.cost, sub.billingCycle),
    0,
  );

  const activeTrials = subscriptions.filter(
    (sub) => sub.trialEndDate && daysUntil(sub.trialEndDate) > 0,
  );
  const expiringSoonTrials = activeTrials.filter(
    (sub) => daysUntil(sub.trialEndDate!) <= 3,
  );

  const tileClass =
    'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 sm:p-4';

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4 mb-6">
      <div className={tileClass}>
        <p className="text-sm text-gray-500 dark:text-gray-400">Daily</p>
        <p className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">
          {formatCurrency(totalDaily)}
        </p>
      </div>
      <div className={tileClass}>
        <p className="text-sm text-gray-500 dark:text-gray-400">Weekly</p>
        <p className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">
          {formatCurrency(totalWeekly)}
        </p>
      </div>
      <div className={tileClass}>
        <p className="text-sm text-gray-500 dark:text-gray-400">Monthly</p>
        <p className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">
          {formatCurrency(totalMonthly)}
        </p>
      </div>
      <div className={tileClass}>
        <p className="text-sm text-gray-500 dark:text-gray-400">Yearly</p>
        <p className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">
          {formatCurrency(totalYearly)}
        </p>
      </div>
      <div className={`${tileClass} col-span-2 sm:col-span-1`}>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Subscriptions
        </p>
        <p className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">
          {activeSubscriptions.length}{' '}
          <span className="text-sm font-normal text-gray-500 dark:text-gray-400">
            active
          </span>
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {inactiveCount} inactive
        </p>
      </div>
      {activeTrials.length > 0 && (
        <div className={tileClass}>
          <p className="text-sm text-gray-500 dark:text-gray-400">Trials</p>
          <p className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">
            {activeTrials.length}{' '}
            <span className="text-sm font-normal text-gray-500 dark:text-gray-400">
              active
            </span>
          </p>
          {expiringSoonTrials.length > 0 && (
            <p className="text-sm text-orange-600 dark:text-orange-400 font-medium">
              {expiringSoonTrials.length} expiring soon
            </p>
          )}
        </div>
      )}
    </div>
  );
}
