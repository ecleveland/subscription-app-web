import Link from 'next/link';

export default function EmptyState() {
  return (
    <div className="text-center py-12">
      <p className="text-gray-500 dark:text-gray-400 mb-4">No subscriptions yet.</p>
      <Link
        href="/subscriptions/new"
        className="inline-block px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
      >
        Add your first subscription
      </Link>
    </div>
  );
}
