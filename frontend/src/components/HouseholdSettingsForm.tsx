'use client';

import { useState, useEffect, FormEvent } from 'react';
import { updateHousehold } from '@/lib/households';
import { useHousehold } from '@/lib/household-context';
import { showErrorToast, showSuccessToast } from '@/lib/toast';

const inputClasses =
  'w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100';

export default function HouseholdSettingsForm() {
  const { household, isOwner, refresh } = useHousehold();
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (household) {
      setName(household.name);
      setCurrency(household.currency);
    }
  }, [household]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('Household name is required.');
      return;
    }
    if (!/^[A-Za-z]{3}$/.test(currency)) {
      setError('Currency must be a 3-letter code (e.g. USD).');
      return;
    }

    setLoading(true);
    try {
      await updateHousehold({
        name: name.trim(),
        currency: currency.toUpperCase(),
      });
      await refresh();
      showSuccessToast('Household updated successfully.');
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to update household';
      setError(message);
      showErrorToast(message);
    } finally {
      setLoading(false);
    }
  }

  if (!household) return null;

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
        Household Settings
      </h2>

      {!isOwner ? (
        <dl className="space-y-2 text-sm max-w-md">
          <div className="flex justify-between">
            <dt className="text-gray-500 dark:text-gray-400">Name</dt>
            <dd className="text-gray-900 dark:text-gray-100">
              {household.name}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500 dark:text-gray-400">Currency</dt>
            <dd className="text-gray-900 dark:text-gray-100">
              {household.currency}
            </dd>
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500 pt-2">
            Only the household owner can edit these settings.
          </p>
        </dl>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
          <div>
            <label
              htmlFor="household-name"
              className="block text-sm font-medium mb-1"
            >
              Name
            </label>
            <input
              id="household-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClasses}
            />
          </div>
          <div>
            <label
              htmlFor="household-currency"
              className="block text-sm font-medium mb-1"
            >
              Currency
            </label>
            <input
              id="household-currency"
              type="text"
              value={currency}
              maxLength={3}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              className={inputClasses}
              placeholder="USD"
            />
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="py-2 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
          >
            {loading ? 'Saving...' : 'Save Changes'}
          </button>
        </form>
      )}
    </div>
  );
}
