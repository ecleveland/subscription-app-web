'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { listTransactions } from '@/lib/transactions';
import { showErrorToast } from '@/lib/toast';
import { formatCents, formatDate } from '@/lib/utils';
import type { Transaction } from '@/lib/types';

export interface MarkReimbursedBlock {
  reimbursedAt: string; // YYYY-MM-DD
  reimbursedByTransactionId?: string;
}

interface MarkReimbursedDialogProps {
  open: boolean;
  count: number;
  onConfirm: (block: MarkReimbursedBlock) => Promise<void> | void;
  onCancel: () => void;
}

const INCOME_LIMIT = 20;

export default function MarkReimbursedDialog({
  open,
  count,
  onConfirm,
  onCancel,
}: MarkReimbursedDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) dialog.showModal?.();
    } else {
      dialog.close?.();
    }
  }, [open]);

  const title = `Mark ${count} ${count === 1 ? 'expense' : 'expenses'} reimbursed`;

  return (
    <dialog
      ref={dialogRef}
      onClose={onCancel}
      aria-labelledby="mark-reimbursed-title"
      className="w-full max-w-md rounded-md border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-ink/40 backdrop:backdrop-blur-[2px]"
    >
      {/* The body mounts on open and unmounts on close, so every open starts
          from today's date, no linked income and a fresh income list. */}
      {open && (
        <DialogBody title={title} onConfirm={onConfirm} onCancel={onCancel} />
      )}
    </dialog>
  );
}

function matchesSearch(t: Transaction, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    (t.payee ?? '').toLowerCase().includes(q) ||
    formatCents(t.amountCents).includes(q) ||
    (t.amountCents / 100).toFixed(2).includes(q)
  );
}

function DialogBody({
  title,
  onConfirm,
  onCancel,
}: {
  title: string;
  onConfirm: MarkReimbursedDialogProps['onConfirm'];
  onCancel: () => void;
}) {
  // UTC day, the same frame the backend stores dates in.
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [incomes, setIncomes] = useState<Transaction[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [paidBy, setPaidBy] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listTransactions({ type: 'income', limit: INCOME_LIMIT })
      .then((res) => {
        if (!cancelled) setIncomes(res.data);
      })
      .catch((err) => {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : 'Failed to load income';
        setLoadError(message);
        showErrorToast(message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The picked row stays listed when the search no longer matches it, so
  // the choice that will be saved is always on screen.
  const visible = useMemo(
    () =>
      (incomes ?? []).filter((t) => t._id === paidBy || matchesSearch(t, search)),
    [incomes, search, paidBy],
  );

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!date || saving) return;
    setSaving(true);
    try {
      await onConfirm(
        paidBy
          ? { reimbursedAt: date, reimbursedByTransactionId: paidBy }
          : { reimbursedAt: date },
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="p-6">
      <h2 id="mark-reimbursed-title" className="section-title mb-4">
        {title}
      </h2>

      <label className="label">
        Reimbursed on
        <input
          type="date"
          required
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="input mt-1"
        />
      </label>

      <fieldset className="mt-5">
        <legend className="label">Paid by</legend>
        <input
          type="search"
          aria-label="Search income"
          placeholder="Search recent income"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input mt-1"
        />
        {loadError ? (
          <p className="mt-2 text-sm text-danger">{loadError}</p>
        ) : incomes === null ? (
          <p className="mt-2 text-sm text-muted">Loading income…</p>
        ) : null}
        <div className="mt-2 max-h-56 space-y-1 overflow-y-auto">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="paidBy"
              value=""
              checked={paidBy === ''}
              onChange={() => setPaidBy('')}
            />
            No linked income
          </label>
          {visible.map((t) => (
            <label key={t._id} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="paidBy"
                value={t._id}
                checked={paidBy === t._id}
                onChange={() => setPaidBy(t._id)}
              />
              {t.payee || 'Income'} · {formatDate(t.date)} ·{' '}
              {formatCents(t.amountCents)}
            </label>
          ))}
          {incomes !== null && incomes.length > 0 && visible.length === 0 && (
            <p className="text-sm text-muted">No income matches</p>
          )}
        </div>
      </fieldset>

      <div className="mt-6 flex justify-end gap-3">
        <button type="button" onClick={onCancel} className="btn-secondary">
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving || !date}
          className="btn-primary"
        >
          {saving ? 'Saving…' : 'Mark reimbursed'}
        </button>
      </div>
    </form>
  );
}
