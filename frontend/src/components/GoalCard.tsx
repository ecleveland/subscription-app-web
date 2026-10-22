'use client';

import { useState, type FormEvent } from 'react';
import { daysUntilTarget, formatDateOnly, goalProgress } from '@/lib/goals';
import { dollarsToCents, formatCents } from '@/lib/utils';
import type { Goal } from '@/lib/types';

interface Props {
  goal: Goal;
  onEdit: (goal: Goal) => void;
  onArchiveToggle: (goal: Goal) => void;
  // Resolves true when the contribution saved, so the card can clear its input.
  onContribute: (id: string, amountCents: number) => Promise<boolean>;
}

function daysLabel(days: number): string {
  if (days === 0) return 'Due today';
  const n = Math.abs(days);
  const unit = n === 1 ? 'day' : 'days';
  return days > 0 ? `${n} ${unit} left` : `${n} ${unit} overdue`;
}

// dollarsToCents rejects negatives, so strip the sign, convert, then reapply.
function parseSignedCents(value: string): number | null {
  const trimmed = value.trim();
  const negative = trimmed.startsWith('-');
  const cents = dollarsToCents(negative ? trimmed.slice(1) : trimmed);
  if (cents === null) return null;
  return negative ? -cents : cents;
}

export default function GoalCard({ goal, onEdit, onArchiveToggle, onContribute }: Props) {
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const { percent } = goalProgress(goal);
  const barWidth = Math.min(100, Math.max(0, percent));
  const days = daysUntilTarget(goal);
  const inputId = `goal-contribution-${goal._id}`;

  async function handleContribute(e: FormEvent) {
    e.preventDefault();
    setError('');
    const cents = parseSignedCents(amount);
    if (cents === null) {
      setError('Enter a valid amount');
      return;
    }
    if (cents === 0) {
      setError('Enter a nonzero amount');
      return;
    }
    setSaving(true);
    try {
      if (await onContribute(goal._id, cents)) setAmount('');
    } finally {
      setSaving(false);
    }
  }

  return (
    <article
      aria-label={goal.name}
      className={`border border-line rounded-md px-4 py-3 bg-surface ${
        goal.isArchived ? 'opacity-60' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-medium text-ink">{goal.name}</h2>
            <span
              className={`text-xs px-1.5 py-0.5 rounded ${
                goal.type === 'debt'
                  ? 'bg-danger-soft text-danger'
                  : 'bg-accent-soft text-accent'
              }`}
            >
              {goal.type === 'debt' ? 'Debt' : 'Savings'}
            </span>
          </div>
          {goal.linkedAccount && (
            <p className="text-xs text-muted mt-1">
              Tracks {goal.linkedAccount.name}
            </p>
          )}
          {goal.targetDate && days !== null && (
            <p className="text-xs text-muted mt-1">
              {formatDateOnly(goal.targetDate)} ·{' '}
              <span className={days < 0 ? 'text-danger' : ''}>
                {daysLabel(days)}
              </span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={() => onEdit(goal)}
            className="text-sm text-ink-2 hover:underline"
          >
            Edit
          </button>
          <button
            onClick={() => onArchiveToggle(goal)}
            className="text-sm text-danger hover:underline"
          >
            {goal.isArchived ? 'Unarchive' : 'Archive'}
          </button>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-sm">
        <span className="text-ink-2">
          {formatCents(goal.currentCents)} of {formatCents(goal.targetCents)}
        </span>
        <span className="font-semibold text-ink">{percent}%</span>
      </div>
      <div
        className="mt-1 h-2 rounded-full bg-surface-2 overflow-hidden"
        role="progressbar"
        aria-label={`${goal.name} progress`}
        aria-valuenow={barWidth}
        aria-valuetext={`${percent}%`}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          aria-hidden="true"
          className={`h-full rounded-full ${
            percent >= 100 ? 'bg-accent' : 'bg-info'
          }`}
          style={{ width: `${barWidth}%` }}
        />
      </div>

      {/* A linked goal follows its account's balance, so manual contributions
          would be rejected. */}
      {!goal.linkedAccount && (
        <form onSubmit={handleContribute} className="mt-3 flex flex-wrap items-end gap-2">
          <div>
            <label
              htmlFor={inputId}
              className="block text-xs font-medium text-ink-2 mb-1"
            >
              Contribution ($)
            </label>
            <input
              id={inputId}
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="input w-32 py-1.5"
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="btn-primary"
          >
            Add
          </button>
          {error && <p className="w-full text-danger text-sm">{error}</p>}
        </form>
      )}
    </article>
  );
}
