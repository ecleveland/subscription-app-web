import Skeleton from './Skeleton';

export default function DashboardSkeleton() {
  return (
    <>
      {/* Summary */}
      <div className="card mb-8 grid overflow-hidden lg:grid-cols-[1.4fr_1fr]">
        <div className="border-b border-line p-5 sm:p-6 lg:border-b-0 lg:border-r">
          <Skeleton className="h-3 w-14" />
          <Skeleton className="mt-3 h-12 w-48" />
          <div className="mt-5 grid grid-cols-3 gap-4 border-t border-line pt-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i}>
                <Skeleton className="h-3 w-10" />
                <Skeleton className="mt-2 h-5 w-16" />
              </div>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 divide-x divide-line lg:grid-cols-1 lg:divide-x-0 lg:divide-y">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="p-5 sm:p-6">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-3 h-8 w-12" />
              <Skeleton className="mt-2 h-4 w-20" />
            </div>
          ))}
        </div>
      </div>

      {/* Search input */}
      <Skeleton className="mb-4 h-10 w-full" />

      {/* Sort bar */}
      <div className="mb-4 flex items-center gap-2">
        <Skeleton className="h-4 w-12" />
        <Skeleton className="h-9 w-48" />
      </div>

      {/* Subscription cards */}
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card p-4">
            <div className="mb-3 flex items-start justify-between">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-5 w-20" />
            </div>
            <Skeleton className="mb-2 h-5 w-20 rounded-full" />
            <Skeleton className="h-4 w-40" />
          </div>
        ))}
      </div>
    </>
  );
}
