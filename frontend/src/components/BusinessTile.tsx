'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getBusinessReport, type BusinessReport } from '@/lib/reports';
import { formatCents } from '@/lib/utils';

// This month's business spend and what is still owed back, across every
// label. The dashboard renders it only when the household has labels.
export default function BusinessTile() {
  const [report, setReport] = useState<BusinessReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // UTC month, matching how the backend buckets transactions.
    const month = new Date().toISOString().slice(0, 7);
    getBusinessReport(month, month)
      .then((r) => {
        if (!cancelled) setReport(r);
      })
      .catch((err) => {
        // Inline only. The dashboard has its own toasts and this tile is a
        // side panel.
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Failed to load business report',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const owedCount = report?.reimbursements.owedCount ?? 0;

  return (
    <section aria-label="Business this month" className="card mb-8 p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <p className="eyebrow">Business this month</p>
        <Link href="/business" className="text-sm text-accent hover:underline">
          Open Business
        </Link>
      </div>
      {error ? (
        <p className="mt-2 text-sm text-danger">{error}</p>
      ) : !report ? (
        <p className="mt-2 text-sm text-muted">Loading…</p>
      ) : (
        <dl className="mt-3 grid grid-cols-2 gap-4">
          <div>
            <dt className="eyebrow">Spend</dt>
            <dd className="num mt-0.5 text-2xl font-medium text-ink">
              {formatCents(report.months[0]?.expenseCents ?? 0)}
            </dd>
          </div>
          <div>
            <dt className="eyebrow">Outstanding</dt>
            <dd className="num mt-0.5 text-2xl font-medium text-ink">
              {formatCents(report.reimbursements.owedCents)}
            </dd>
            <dd className="text-sm text-muted">
              {owedCount === 1 ? '1 expense' : `${owedCount} expenses`}
            </dd>
          </div>
        </dl>
      )}
    </section>
  );
}
