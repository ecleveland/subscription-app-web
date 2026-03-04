'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { Subscription, CATEGORIES } from '@/lib/types';
import { showErrorToast, showSuccessToast } from '@/lib/toast';

interface Props {
  subscription?: Subscription;
}

export default function SubscriptionForm({ subscription }: Props) {
  const router = useRouter();
  const isEditing = !!subscription;

  const [name, setName] = useState(subscription?.name ?? '');
  const [cost, setCost] = useState(subscription?.cost?.toString() ?? '');
  const [billingCycle, setBillingCycle] = useState<'weekly' | 'monthly' | 'yearly'>(
    subscription?.billingCycle ?? 'monthly',
  );
  const [nextBillingDate, setNextBillingDate] = useState(
    subscription?.nextBillingDate
      ? new Date(subscription.nextBillingDate).toISOString().split('T')[0]
      : '',
  );
  const [category, setCategory] = useState(subscription?.category ?? CATEGORIES[0]);
  const [notes, setNotes] = useState(subscription?.notes ?? '');
  const [isActive, setIsActive] = useState(subscription?.isActive !== false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const body = {
      name,
      cost: parseFloat(cost),
      billingCycle,
      nextBillingDate,
      category,
      isActive,
      ...(notes ? { notes } : {}),
    };

    try {
      if (isEditing) {
        await apiFetch(`/subscriptions/${subscription._id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
        showSuccessToast('Subscription updated');
      } else {
        await apiFetch('/subscriptions', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        showSuccessToast('Subscription created');
      }
      router.push('/');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong';
      setError(message);
      showErrorToast(message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    if (!confirm('Are you sure you want to delete this subscription?')) return;

    try {
      await apiFetch(`/subscriptions/${subscription!._id}`, {
        method: 'DELETE',
      });
      showSuccessToast('Subscription deleted');
      router.push('/');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete';
      setError(message);
      showErrorToast(message);
    }
  }

  const inputClasses =
    'w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100';
  const labelClasses = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1';

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-lg">
      <div>
        <label htmlFor="name" className={labelClasses}>
          Name
        </label>
        <input
          id="name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className={inputClasses}
          placeholder="Netflix"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="cost" className={labelClasses}>
            Cost ($)
          </label>
          <input
            id="cost"
            type="number"
            step="0.01"
            min="0"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            required
            className={inputClasses}
            placeholder="15.99"
          />
        </div>
        <div>
          <label
            htmlFor="billingCycle"
            className={labelClasses}
          >
            Billing Cycle
          </label>
          <select
            id="billingCycle"
            value={billingCycle}
            onChange={(e) => setBillingCycle(e.target.value as 'weekly' | 'monthly' | 'yearly')}
            className={inputClasses}
          >
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label
            htmlFor="nextBillingDate"
            className={labelClasses}
          >
            Next Billing Date
          </label>
          <input
            id="nextBillingDate"
            type="date"
            value={nextBillingDate}
            onChange={(e) => setNextBillingDate(e.target.value)}
            required
            className={inputClasses}
          />
        </div>
        <div>
          <label
            htmlFor="category"
            className={labelClasses}
          >
            Category
          </label>
          <select
            id="category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={inputClasses}
          >
            {CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input
          id="isActive"
          type="checkbox"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
          className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
        />
        <label htmlFor="isActive" className={labelClasses}>
          Active subscription
        </label>
      </div>

      <div>
        <label htmlFor="notes" className={labelClasses}>
          Notes (optional)
        </label>
        <textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className={inputClasses}
          placeholder="Family plan, shared with..."
        />
      </div>

      {error && <p className="text-red-500 text-sm">{error}</p>}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors font-medium"
        >
          {loading ? 'Saving...' : isEditing ? 'Update' : 'Create'}
        </button>
        <button
          type="button"
          onClick={() => router.push('/')}
          className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-gray-700 dark:text-gray-300"
        >
          Cancel
        </button>
        {isEditing && (
          <button
            type="button"
            onClick={handleDelete}
            className="ml-auto px-4 py-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
          >
            Delete
          </button>
        )}
      </div>
    </form>
  );
}
