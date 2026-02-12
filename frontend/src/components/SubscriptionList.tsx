import { Subscription } from '@/lib/types';
import SubscriptionCard from './SubscriptionCard';
import EmptyState from './EmptyState';

export default function SubscriptionList({
  subscriptions,
}: {
  subscriptions: Subscription[];
}) {
  if (subscriptions.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {subscriptions.map((sub) => (
        <SubscriptionCard key={sub._id} subscription={sub} />
      ))}
    </div>
  );
}
