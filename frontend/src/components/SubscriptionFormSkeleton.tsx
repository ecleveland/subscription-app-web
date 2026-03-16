import Skeleton from './Skeleton';

export default function SubscriptionFormSkeleton() {
  return (
    <div className="space-y-4 max-w-lg">
      {/* Name input */}
      <div>
        <Skeleton className="h-4 w-12 mb-1" />
        <Skeleton className="h-10 w-full" />
      </div>

      {/* Cost / Billing Cycle row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Skeleton className="h-4 w-16 mb-1" />
          <Skeleton className="h-10 w-full" />
        </div>
        <div>
          <Skeleton className="h-4 w-24 mb-1" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>

      {/* Date / Category row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Skeleton className="h-4 w-28 mb-1" />
          <Skeleton className="h-10 w-full" />
        </div>
        <div>
          <Skeleton className="h-4 w-16 mb-1" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>

      {/* Active checkbox */}
      <div className="flex items-center gap-2">
        <Skeleton className="h-4 w-4" />
        <Skeleton className="h-4 w-32" />
      </div>

      {/* Notes textarea */}
      <div>
        <Skeleton className="h-4 w-28 mb-1" />
        <Skeleton className="h-20 w-full" />
      </div>

      {/* Button row */}
      <div className="flex gap-3">
        <Skeleton className="h-10 w-20" />
        <Skeleton className="h-10 w-20" />
      </div>
    </div>
  );
}
