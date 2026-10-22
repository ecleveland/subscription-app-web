import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper">
      <div className="max-w-md px-6 text-center">
        <p className="eyebrow">Error 404</p>
        <h1 className="num mt-3 font-display text-7xl font-medium tracking-tight text-ink">
          404
        </h1>
        <p className="mt-3 font-display text-2xl text-ink">Page not found</p>
        <p className="mt-2 text-sm text-muted">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <Link href="/" className="btn-primary mt-8">
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
