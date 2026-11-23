'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { useLabels } from '@/lib/labels-context';
import { LABEL_FILTER_ANY } from '@/lib/labels';
import { useReport } from '@/lib/use-report';
import {
  defaultRange,
  formatSignedCents,
  getBusinessReport,
  type BusinessMonth,
  type BusinessReimbursementRow,
  type BusinessReport,
  type CashFlowMonth,
} from '@/lib/reports';
import { listCategories } from '@/lib/categories';
import { setReimbursement } from '@/lib/transactions';
import { daysUntil, formatCents, formatDate } from '@/lib/utils';
import { showErrorToast, showSuccessToast } from '@/lib/toast';
import CashFlowChart from '@/components/CashFlowChart';
import SpendingReportChart from '@/components/SpendingReportChart';
import LabelChip from '@/components/LabelChip';
import MarkReimbursedDialog, {
  type MarkReimbursedBlock,
} from '@/components/MarkReimbursedDialog';
import {
  ReportSection,
  ReportBody,
  cardClass,
  linkButtonClass,
} from '@/components/ReportSection';
import type { Label } from '@/lib/types';

function expenses(n: number): string {
  return n === 1 ? '1 expense' : `${n} expenses`;
}

function changeText(current: number, previous: number): string {
  const delta = current - previous;
  return delta === 0 ? 'No change' : `${formatSignedCents(delta)} vs last month`;
}

// Whole UTC days since the expense date.
function ageText(date: string): string {
  const days = -daysUntil(date);
  if (days <= 0) return 'today';
  return days === 1 ? '1 day' : `${days} days`;
}

// "2026-02" to "2026-02-28". Day 0 of the next month is the last day of this
// one.
function lastDayOf(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const day = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(day).padStart(2, '0')}`;
}

function Tile({
  name,
  cents,
  change,
}: {
  name: string;
  cents: number;
  change: string;
}) {
  return (
    <div role="group" aria-label={name} className="p-4">
      <p className="eyebrow">{name}</p>
      <p className="num mt-1 text-2xl font-medium text-ink">{formatCents(cents)}</p>
      <p className="mt-1 text-sm text-muted">{change}</p>
    </div>
  );
}

function ThisMonth({ months }: { months: BusinessMonth[] }) {
  const zero = { expenseCents: 0, incomeCents: 0 };
  const current = months.at(-1) ?? zero;
  const previous = months.at(-2) ?? zero;
  const net = (m: { expenseCents: number; incomeCents: number }) =>
    m.incomeCents - m.expenseCents;
  return (
    <div className="grid grid-cols-1 divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
      <Tile
        name="Spend"
        cents={current.expenseCents}
        change={changeText(current.expenseCents, previous.expenseCents)}
      />
      <Tile
        name="Income"
        cents={current.incomeCents}
        change={changeText(current.incomeCents, previous.incomeCents)}
      />
      <Tile
        name="Net"
        cents={net(current)}
        change={changeText(net(current), net(previous))}
      />
    </div>
  );
}

export default function BusinessPage() {
  const { isAuthenticated } = useAuth();
  const { labels, loading: labelsLoading, error: labelsError } = useLabels();
  const router = useRouter();

  // Empty is every label.
  const [labelId, setLabelId] = useState('');
  const [netOfReimbursements, setNetOfReimbursements] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  // Bumped after a write so the report refetches.
  const [reloadKey, setReloadKey] = useState(0);
  const [range] = useState(defaultRange);
  const [categoryNames, setCategoryNames] = useState<Map<string, string>>(
    () => new Map(),
  );

  const hasLabels = labels.length > 0;
  // A failed refetch keeps the last-known labels, and those are enough to
  // run the report. A failed first load leaves no labels to go on.
  const canLoad = isAuthenticated && hasLabels;
  const labelById = useMemo(
    () => new Map(labels.map((l) => [l._id, l])),
    [labels],
  );

  const report = useReport<BusinessReport>(
    'Business',
    canLoad
      ? `${range.from}..${range.to}|${labelId}|${reloadKey}`
      : null,
    () => getBusinessReport(range.from, range.to, labelId || undefined),
    'Failed to load business report',
  );

  // Archived categories included, so older expenses keep their names.
  useEffect(() => {
    if (!canLoad) return;
    let cancelled = false;
    listCategories(true)
      .then((cs) => {
        if (!cancelled) setCategoryNames(new Map(cs.map((c) => [c._id, c.name])));
      })
      .catch((err) =>
        showErrorToast(
          err instanceof Error ? err.message : 'Failed to load categories',
        ),
      );
    return () => {
      cancelled = true;
    };
  }, [canLoad]);

  function changeLabel(id: string) {
    setLabelId(id);
    // Ids picked under the old label may not be on screen any more.
    setSelected(new Set());
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openDialog(ids: string[]) {
    setPendingIds(ids);
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setPendingIds([]);
  }

  function openMonth(month: string) {
    const params = new URLSearchParams({
      labelId: labelId || LABEL_FILTER_ANY,
      dateFrom: `${month}-01`,
      dateTo: lastDayOf(month),
    });
    router.push(`/transactions?${params}`);
  }

  async function mark(ids: string[], block: MarkReimbursedBlock) {
    const results = await Promise.allSettled(
      ids.map((id) => setReimbursement(id, { status: 'reimbursed', ...block })),
    );
    const failedIds = ids.filter((_, i) => results[i].status === 'rejected');
    const firstFailure = results.find(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    const message =
      firstFailure?.reason instanceof Error
        ? firstFailure.reason.message
        : 'Failed to mark reimbursed';

    if (failedIds.length === ids.length) {
      // Nothing changed. Keep the dialog open so the user can retry.
      showErrorToast(message);
      return;
    }
    const done = ids.length - failedIds.length;
    showSuccessToast(`${expenses(done)} marked reimbursed`);
    if (failedIds.length > 0) {
      showErrorToast(`${failedIds.length} of ${ids.length} failed: ${message}`);
    }
    // Drop only what was marked. Failed rows and rows checked for a later
    // bulk action stay selected.
    const failed = new Set(failedIds);
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) if (!failed.has(id)) next.delete(id);
      return next;
    });
    closeDialog();
    setReloadKey((k) => k + 1);
  }

  async function markOwed(id: string) {
    try {
      await setReimbursement(id, { status: 'owed' });
      showSuccessToast('Marked as owed');
      setReloadKey((k) => k + 1);
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to mark as owed');
    }
  }

  // A failed load says nothing about whether labels exist, so only a
  // successful load that came back empty gets the empty state.
  const noLabels = !labelsLoading && !hasLabels && labelsError === null;

  return (
    <main className="max-w-5xl mx-auto px-4 py-8 md:px-8 md:py-10">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <h1 className="page-title">Business</h1>
        {hasLabels && (
          <select
            aria-label="Business label"
            value={labelId}
            onChange={(e) => changeLabel(e.target.value)}
            className="input w-auto"
          >
            <option value="">All business</option>
            {labels.map((l) => (
              <option key={l._id} value={l._id}>
                {l.isArchived ? `${l.name} (archived)` : l.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {labelsError && (
        <p className="mb-6 text-sm text-danger">
          Couldn&apos;t load labels: {labelsError}
        </p>
      )}

      {noLabels ? (
        <div className={`${cardClass} text-center py-8`}>
          <p className="text-muted">
            No labels yet. Create one on the Categories page.
          </p>
          <Link href="/categories" className={linkButtonClass}>
            Go to Categories
          </Link>
        </div>
      ) : !hasLabels ? (
        // With an error there is nothing to load. The message above says why.
        labelsError ? null : <p className="text-muted">Loading labels…</p>
      ) : (
        <>
          <ReportSection id="business-this-month" title="This month">
            <ReportBody
              state={report}
              loadingText="Loading this month…"
              isEmpty={() => false}
              empty={null}
            >
              {(r) => <ThisMonth months={r.months} />}
            </ReportBody>
          </ReportSection>

          <ReportSection
            id="business-months"
            title="Month to month"
            controls={
              <label className="flex items-center gap-2 text-sm text-ink-2">
                <input
                  type="checkbox"
                  checked={netOfReimbursements}
                  onChange={(e) => setNetOfReimbursements(e.target.checked)}
                />
                Net of reimbursements
              </label>
            }
          >
            <ReportBody
              state={report}
              loadingText="Loading months…"
              isEmpty={(r) =>
                r.months.every((m) => m.incomeCents === 0 && m.expenseCents === 0)
              }
              empty={
                <p className="text-muted">No business activity in this range</p>
              }
            >
              {(r) => (
                <CashFlowChart
                  months={r.months.map((m): CashFlowMonth => {
                    const expenseCents = netOfReimbursements
                      ? m.expenseCents - m.reimbursedCents
                      : m.expenseCents;
                    return {
                      month: m.month,
                      incomeCents: m.incomeCents,
                      expenseCents,
                      netCents: m.incomeCents - expenseCents,
                    };
                  })}
                  onMonthClick={openMonth}
                />
              )}
            </ReportBody>
          </ReportSection>

          <ReportSection id="business-categories" title="Spend by category">
            <ReportBody
              state={report}
              loadingText="Loading spend…"
              // Matches SpendingReportChart, which adds the Uncategorized row
              // only when it is positive.
              isEmpty={(r) =>
                r.categories.length === 0 && r.uncategorizedCents <= 0
              }
              empty={<p className="text-muted">No business spend in this range</p>}
            >
              {(r) => (
                <SpendingReportChart
                  showPlanned={false}
                  report={{
                    month: range.to,
                    categories: r.categories,
                    uncategorizedCents: r.uncategorizedCents,
                    totalCents: r.totalCents,
                  }}
                />
              )}
            </ReportBody>
          </ReportSection>

          <ReportSection id="business-reimbursements" title="Reimbursements">
            <ReportBody
              state={report}
              loadingText="Loading reimbursements…"
              isEmpty={() => false}
              empty={null}
            >
              {(r) => (
                <Reimbursements
                  report={r}
                  showLabels={labelId === ''}
                  labelById={labelById}
                  categoryNames={categoryNames}
                  selected={selected}
                  onToggle={toggleSelected}
                  onMark={openDialog}
                  onMarkOwed={markOwed}
                />
              )}
            </ReportBody>
          </ReportSection>

          <MarkReimbursedDialog
            open={dialogOpen}
            count={pendingIds.length}
            onConfirm={(block) => mark(pendingIds, block)}
            onCancel={closeDialog}
          />
        </>
      )}
    </main>
  );
}

function Reimbursements({
  report,
  showLabels,
  labelById,
  categoryNames,
  selected,
  onToggle,
  onMark,
  onMarkOwed,
}: {
  report: BusinessReport;
  showLabels: boolean;
  labelById: Map<string, Label>;
  categoryNames: Map<string, string>;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onMark: (ids: string[]) => void;
  onMarkOwed: (id: string) => void;
}) {
  const { owedCents, owedCount, owed, reimbursed } = report.reimbursements;
  // Only ids still owed in this report count toward the bulk action.
  const owedIds = new Set(owed.map((row) => row.id));
  const selectedIds = [...selected].filter((id) => owedIds.has(id));

  return (
    <div>
      <p className="text-sm text-ink-2">
        Outstanding:{' '}
        <span className="num font-semibold text-ink">
          {formatCents(owedCents)}
        </span>{' '}
        across {expenses(owedCount)}
      </p>

      {selectedIds.length > 0 && (
        <div className="mt-3 flex items-center gap-3 rounded-md bg-accent-soft px-3 py-2">
          <span className="text-sm text-accent">{selectedIds.length} selected</span>
          <button
            type="button"
            onClick={() => onMark(selectedIds)}
            className="btn-primary ml-auto"
          >
            Mark {selectedIds.length} reimbursed
          </button>
        </div>
      )}

      {owed.length === 0 ? (
        <p className="mt-4 text-sm text-muted">Nothing owed in this range</p>
      ) : (
        <ul aria-label="Owed reimbursements" className="mt-4 divide-y divide-line">
          {owed.map((row) => (
            <OwedRow
              key={row.id}
              row={row}
              label={showLabels ? labelById.get(row.labelId) : undefined}
              categoryName={row.categoryId ? categoryNames.get(row.categoryId) : undefined}
              checked={selected.has(row.id)}
              onToggle={() => onToggle(row.id)}
              onMark={() => onMark([row.id])}
            />
          ))}
        </ul>
      )}

      <h3 className="mt-6 text-sm font-semibold text-ink">Reimbursed in this range</h3>
      {reimbursed.length === 0 ? (
        <p className="mt-2 text-sm text-muted">
          No reimbursements recorded in this range
        </p>
      ) : (
        <ul aria-label="Reimbursed expenses" className="mt-2 divide-y divide-line">
          {reimbursed.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <span className="text-muted">{formatDate(row.date)}</span>
              <span className="font-medium">{row.payee ?? 'No payee'}</span>
              <span className="num">{formatCents(row.amountCents)}</span>
              {row.reimbursedAt && (
                <span className="text-accent">
                  Reimbursed {formatDate(row.reimbursedAt)}
                </span>
              )}
              <button
                type="button"
                onClick={() => onMarkOwed(row.id)}
                className="ml-auto text-sm text-ink-2 hover:underline"
              >
                Mark as owed again
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OwedRow({
  row,
  label,
  categoryName,
  checked,
  onToggle,
  onMark,
}: {
  row: BusinessReimbursementRow;
  label: Label | undefined;
  categoryName: string | undefined;
  checked: boolean;
  onToggle: () => void;
  onMark: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-3 py-2 text-sm">
      <input
        type="checkbox"
        aria-label={`Select ${row.payee ?? 'expense'}`}
        checked={checked}
        onChange={onToggle}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{row.payee ?? 'No payee'}</span>
          <LabelChip label={label} />
        </div>
        <p className="text-xs text-muted">
          {formatDate(row.date)} · <span className="text-warn">{ageText(row.date)}</span>
          {categoryName && ` · ${categoryName}`}
        </p>
      </div>
      <span className="num font-semibold">{formatCents(row.amountCents)}</span>
      <button type="button" onClick={onMark} className="btn-secondary">
        Mark reimbursed
      </button>
    </li>
  );
}
