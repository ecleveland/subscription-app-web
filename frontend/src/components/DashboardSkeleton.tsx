import Skeleton from './Skeleton';

export default function DashboardSkeleton() {
  const tileClass =
    'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 sm:p-4';

  return (
    <>
      {/* Summary tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4 mb-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={tileClass}>
            <Skeleton className="h-4 w-12 mb-2" />
            <Skeleton className="h-7 w-20" />
          </div>
        ))}
        <div className={`${tileClass} col-span-2 sm:col-span-1`}>
          <Skeleton className="h-4 w-24 mb-2" />
          <Skeleton className="h-7 w-16 mb-1" />
          <Skeleton className="h-4 w-20" />
        </div>
      </div>

      {/* Search input */}
      <Skeleton className="h-10 w-full mb-4" />

      {/* Sort bar */}
      <div className="flex items-center gap-2 mb-4">
        <Skeleton className="h-4 w-12" />
        <Skeleton className="h-9 w-48" />
      </div>

      {/* Subscription cards */}
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-800"
          >
            <div className="flex items-start justify-between mb-2">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-6 w-16" />
            </div>
            <Skeleton className="h-5 w-20 mb-2" />
            <Skeleton className="h-4 w-40" />
          </div>
        ))}
      </div>
    </>
  );
}
