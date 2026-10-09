'use client';

import { useState, type FormEvent } from 'react';
import { daysUntilTarget, goalProgress } from '@/lib/goals';
import { dollarsToCents, formatCents, formatDate } from '@/lib/utils';
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
      className={`border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-3 bg-white dark:bg-gray-800 ${
        goal.isArchived ? 'opacity-60' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-medium text-gray-900 dark:text-gray-100">{goal.name}</h2>
            <span
              className={`text-xs px-1.5 py-0.5 rounded ${
                goal.type === 'debt'
                  ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                  : 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
              }`}
            >
              {goal.type === 'debt' ? 'Debt' : 'Savings'}
            </span>
          </div>
          {goal.targetDate && days !== null && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {/* Noon UTC keeps a date-only value on the same calendar day in
                  any viewer timezone when formatDate renders it locally. */}
              {formatDate(`${goal.targetDate.slice(0, 10)}T12:00:00Z`)} ·{' '}
              <span className={days < 0 ? 'text-red-600 dark:text-red-400' : ''}>
                {daysLabel(days)}
              </span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={() => onEdit(goal)}
            className="text-sm text-gray-600 dark:text-gray-300 hover:underline"
          >
            Edit
          </button>
          <button
            onClick={() => onArchiveToggle(goal)}
            className="text-sm text-red-600 dark:text-red-400 hover:underline"
          >
            {goal.isArchived ? 'Unarchive' : 'Archive'}
          </button>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-sm">
        <span className="text-gray-700 dark:text-gray-300">
          {formatCents(goal.currentCents)} of {formatCents(goal.targetCents)}
        </span>
        <span className="font-semibold text-gray-900 dark:text-gray-100">{percent}%</span>
      </div>
      <div
        className="mt-1 h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden"
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
            percent >= 100 ? 'bg-green-500' : 'bg-blue-500'
          }`}
          style={{ width: `${barWidth}%` }}
        />
      </div>

      <form onSubmit={handleContribute} className="mt-3 flex flex-wrap items-end gap-2">
        <div>
          <label
            htmlFor={inputId}
            className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1"
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
            className="w-32 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700"
          />
        </div>
        <button
          type="submit"
          disabled={saving}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          Add
        </button>
        {error && <p className="w-full text-red-500 dark:text-red-400 text-sm">{error}</p>}
      </form>
    </article>
  );
}
