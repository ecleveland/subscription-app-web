'use client';

import { useState, useEffect, FormEvent } from 'react';
import { updateHousehold } from '@/lib/households';
import { useHousehold } from '@/lib/household-context';
import { showErrorToast, showSuccessToast } from '@/lib/toast';

const inputClasses =
  'input';

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
      <h2 className="section-title mb-4">
        Household Settings
      </h2>

      {!isOwner ? (
        <dl className="space-y-2 text-sm max-w-md">
          <div className="flex justify-between">
            <dt className="text-muted">Name</dt>
            <dd className="text-ink">
              {household.name}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Currency</dt>
            <dd className="text-ink">
              {household.currency}
            </dd>
          </div>
          <p className="text-xs text-muted pt-2">
            Only the household owner can edit these settings.
          </p>
        </dl>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
          <div>
            <label
              htmlFor="household-name"
              className="label"
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
              className="label"
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
          {error && <p className="text-danger text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="btn-primary"
          >
            {loading ? 'Saving...' : 'Save Changes'}
          </button>
        </form>
      )}
    </div>
  );
}
