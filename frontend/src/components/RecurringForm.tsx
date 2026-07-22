'use client';

import { useState, type FormEvent } from 'react';
import {
  createRecurring,
  updateRecurring,
  type RecurringInput,
} from '@/lib/recurring';
import { dollarsToCents } from '@/lib/utils';
import { showErrorToast, showSuccessToast } from '@/lib/toast';
import TagInput from './TagInput';
import type {
  Account,
  BudgetCategory,
  RecurringCadence,
  RecurringTransaction,
  RecurringType,
} from '@/lib/types';

interface Props {
  recurring?: RecurringTransaction;
  accounts: Account[];
  categories: BudgetCategory[];
  onSaved: () => void;
  onCancel: () => void;
}

const TYPES: RecurringType[] = ['expense', 'income'];
const CADENCES: RecurringCadence[] = ['weekly', 'monthly', 'yearly'];

export default function RecurringForm({
  recurring,
  accounts,
  categories,
  onSaved,
  onCancel,
}: Props) {
  const isEditing = !!recurring;
  const [type, setType] = useState<RecurringType>(recurring?.type ?? 'expense');
  const [accountId, setAccountId] = useState(
    recurring?.accountId ?? accounts[0]?._id ?? '',
  );
  const [categoryId, setCategoryId] = useState(recurring?.categoryId ?? '');
  const [amount, setAmount] = useState(
    recurring ? (recurring.amountCents / 100).toFixed(2) : '',
  );
  const [payee, setPayee] = useState(recurring?.payee ?? '');
  const [cadence, setCadence] = useState<RecurringCadence>(
    recurring?.cadence ?? 'monthly',
  );
  const [nextDate, setNextDate] = useState(recurring?.nextDate?.slice(0, 10) ?? '');
  const [reminderDaysBefore, setReminderDaysBefore] = useState(
    recurring?.reminderDaysBefore?.toString() ?? '3',
  );
  const [hasEndDate, setHasEndDate] = useState(!!recurring?.endDate);
  const [endDate, setEndDate] = useState(recurring?.endDate?.slice(0, 10) ?? '');
  const [notes, setNotes] = useState(recurring?.notes ?? '');
  const [tags, setTags] = useState<string[]>(recurring?.tags ?? []);
  const [isActive, setIsActive] = useState(recurring?.isActive !== false);
  const [isSubscription, setIsSubscription] = useState(
    recurring?.isSubscription ?? false,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isExpense = type === 'expense';
  // Offer income categories for income, expense categories for expense.
  const selectableCategories = categories.filter(
    (c) => c.isIncome === (type === 'income'),
  );

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    const amountCents = dollarsToCents(amount);
    if (amountCents === null || amountCents <= 0) {
      setError('Amount must be a positive number');
      return;
    }
    if (!categoryId) {
      setError('Please choose a category');
      return;
    }
    if (hasEndDate && endDate && endDate < nextDate) {
      setError('End date must be on or after the next date');
      return;
    }

    const parsedReminder = parseInt(reminderDaysBefore, 10);

    const body: RecurringInput = {
      accountId,
      categoryId,
      type,
      amountCents,
      payee: payee.trim(),
      cadence,
      nextDate,
      reminderDaysBefore: Number.isFinite(parsedReminder) ? parsedReminder : 3,
      isActive,
      // The subscription flag only applies to expenses (income can't be a
      // subscription); force it off for income.
      isSubscription: isExpense ? isSubscription : false,
      notes: isEditing ? notes.trim() : notes.trim() || undefined,
      tags,
    };

    // Send an explicit end date, or null to clear it on edit.
    if (hasEndDate && endDate) {
      body.endDate = endDate;
    } else if (!hasEndDate && isEditing) {
      body.endDate = null;
    }

    setLoading(true);
    try {
      if (isEditing) {
        await updateRecurring(recurring._id, body);
        showSuccessToast('Schedule updated');
      } else {
        await createRecurring(body);
        showSuccessToast('Schedule created');
      }
      onSaved();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong';
      setError(message);
      showErrorToast(message);
    } finally {
      setLoading(false);
    }
  }

  const inputClass =
    'w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700';
  const labelClass = 'block text-sm font-medium mb-1';

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 max-w-md border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-800"
    >
      <h2 className="text-lg font-semibold">
        {isEditing ? 'Edit schedule' : 'New schedule'}
      </h2>

      <div>
        <label htmlFor="rec-type" className={labelClass}>
          Type
        </label>
        <select
          id="rec-type"
          value={type}
          onChange={(e) => {
            setType(e.target.value as RecurringType);
            // Income and expense draw from different category sets; drop the
            // prior choice so a stale, wrong-type category can't be submitted.
            setCategoryId('');
          }}
          className={inputClass}
        >
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t === 'expense' ? 'Bill (expense)' : 'Scheduled income'}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="rec-account" className={labelClass}>
          Account
        </label>
        <select
          id="rec-account"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          required
          className={inputClass}
        >
          {accounts.map((a) => (
            <option key={a._id} value={a._id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="rec-category" className={labelClass}>
          Category
        </label>
        <select
          id="rec-category"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className={inputClass}
        >
          <option value="">Select category…</option>
          {selectableCategories.map((c) => (
            <option key={c._id} value={c._id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="rec-payee" className={labelClass}>
          Payee
        </label>
        <input
          id="rec-payee"
          value={payee}
          onChange={(e) => setPayee(e.target.value)}
          required
          className={inputClass}
          placeholder="Netflix"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="rec-amount" className={labelClass}>
            Amount ($)
          </label>
          <input
            id="rec-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            required
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="rec-cadence" className={labelClass}>
            Cadence
          </label>
          <select
            id="rec-cadence"
            value={cadence}
            onChange={(e) => setCadence(e.target.value as RecurringCadence)}
            className={inputClass}
          >
            {CADENCES.map((c) => (
              <option key={c} value={c}>
                {c.charAt(0).toUpperCase() + c.slice(1)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="rec-next" className={labelClass}>
          Next date
        </label>
        <input
          id="rec-next"
          type="date"
          value={nextDate}
          onChange={(e) => setNextDate(e.target.value)}
          required
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="rec-reminder" className={labelClass}>
          Remind me before (days)
        </label>
        <input
          id="rec-reminder"
          type="number"
          min="0"
          max="30"
          required
          value={reminderDaysBefore}
          onChange={(e) => setReminderDaysBefore(e.target.value)}
          className={inputClass}
        />
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Set to 0 to disable reminders for this schedule.
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={hasEndDate}
          onChange={(e) => setHasEndDate(e.target.checked)}
        />
        Has end date
      </label>

      {hasEndDate && (
        <div>
          <label htmlFor="rec-end" className={labelClass}>
            End date
          </label>
          <input
            id="rec-end"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className={inputClass}
          />
        </div>
      )}

      {isExpense && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isSubscription}
            onChange={(e) => setIsSubscription(e.target.checked)}
          />
          This is a subscription
        </label>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
        />
        Active
      </label>

      <div>
        <label htmlFor="rec-notes" className={labelClass}>
          Notes
        </label>
        <textarea
          id="rec-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className={inputClass}
        />
      </div>

      <div>
        <label className={labelClass}>Tags</label>
        <TagInput tags={tags} onChange={setTags} />
      </div>

      {error && <p className="text-red-500 text-sm">{error}</p>}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Saving...' : isEditing ? 'Update' : 'Add'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
