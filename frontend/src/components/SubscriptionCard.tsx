import Link from 'next/link';
import { Subscription } from '@/lib/types';
import { formatCurrency, formatDate, daysUntil, getMonthlyCost } from '@/lib/utils';
import CategoryBadge from './CategoryBadge';

export default function SubscriptionCard({
  subscription,
}: {
  subscription: Subscription;
}) {
  const days = daysUntil(subscription.nextBillingDate);
  const monthly = getMonthlyCost(subscription.cost, subscription.billingCycle);

  return (
    <Link
      href={`/subscriptions/${subscription._id}/edit`}
      className="block border border-gray-200 rounded-lg p-4 hover:border-blue-300 hover:shadow-sm transition-all bg-white"
    >
      <div className="flex items-start justify-between mb-2">
        <h3 className="font-semibold text-gray-900">{subscription.name}</h3>
        <span className="text-lg font-bold text-gray-900">
          {formatCurrency(subscription.cost)}
          <span className="text-xs text-gray-500 font-normal">
            /{subscription.billingCycle === 'monthly' ? 'mo' : 'yr'}
          </span>
        </span>
      </div>
      <div className="flex items-center gap-2 mb-2">
        <CategoryBadge category={subscription.category} />
        {subscription.billingCycle === 'yearly' && (
          <span className="text-xs text-gray-500">
            ({formatCurrency(monthly)}/mo)
          </span>
        )}
      </div>
      <div className="text-sm text-gray-500">
        Next billing: {formatDate(subscription.nextBillingDate)}
        {days >= 0 && (
          <span className={days <= 3 ? ' text-red-500 font-medium' : ''}>
            {' '}
            ({days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`})
          </span>
        )}
        {days < 0 && (
          <span className="text-red-500 font-medium"> (overdue)</span>
        )}
      </div>
    </Link>
  );
}
