import Skeleton from '../Skeleton';

export default function UserTableSkeleton() {
  return (
    <div>
      {/* Mobile card view */}
      <div className="md:hidden space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4"
          >
            <div className="flex items-center justify-between mb-2">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-5 w-12 rounded-full" />
            </div>
            <Skeleton className="h-4 w-32 mb-1" />
            <Skeleton className="h-4 w-40" />
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-4 w-12" />
            </div>
          </div>
        ))}
      </div>

      {/* Desktop table view */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs uppercase bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
            <tr>
              <th className="px-4 py-3">Username</th>
              <th className="px-4 py-3">Display Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {Array.from({ length: 5 }).map((_, i) => (
              <tr key={i} className="bg-white dark:bg-gray-800">
                <td className="px-4 py-3">
                  <Skeleton className="h-4 w-20" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-4 w-24" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-4 w-36" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-5 w-12 rounded-full" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-4 w-20" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-4 w-12" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
