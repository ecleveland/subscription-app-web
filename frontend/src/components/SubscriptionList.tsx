import { Subscription } from '@/lib/types';
import SubscriptionCard from './SubscriptionCard';
import EmptyState from './EmptyState';

export default function SubscriptionList({
  subscriptions,
  onToggleActive,
  selectionMode,
  selectedIds,
  onSelect,
}: {
  subscriptions: Subscription[];
  onToggleActive?: (id: string, isActive: boolean) => void;
  selectionMode?: boolean;
  selectedIds?: Set<string>;
  onSelect?: (id: string) => void;
}) {
  if (subscriptions.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {subscriptions.map((sub) => (
        <SubscriptionCard
          key={sub._id}
          subscription={sub}
          onToggleActive={onToggleActive}
          selectionMode={selectionMode}
          isSelected={selectedIds?.has(sub._id)}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
