import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="text-center px-6">
        <svg
          className="mx-auto mb-6 h-20 w-20 text-gray-400 dark:text-gray-500"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 9l6 6M15 9l-6 6"
          />
        </svg>
        <h1 className="text-6xl font-bold text-gray-900 dark:text-gray-100">
          404
        </h1>
        <p className="mt-3 text-xl text-gray-700 dark:text-gray-300">
          Page not found
        </p>
        <p className="mt-2 text-gray-500 dark:text-gray-400">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <Link
          href="/"
          className="mt-8 inline-block px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
