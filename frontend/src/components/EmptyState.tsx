import Link from 'next/link';

export default function EmptyState() {
  return (
    <div className="card border-dashed px-6 py-14 text-center">
      <p className="font-display text-2xl font-medium tracking-tight text-ink">
        Nothing on the books yet.
      </p>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
        No subscriptions yet. Add the first one and the monthly total above starts
        meaning something.
      </p>
      <Link href="/subscriptions/new" className="btn-primary mt-6">
        Add your first subscription
      </Link>
    </div>
  );
}
