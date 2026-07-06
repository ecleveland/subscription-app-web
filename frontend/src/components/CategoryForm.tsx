'use client';

import { useState, type FormEvent } from 'react';
import { createCategory, updateCategory } from '@/lib/categories';
import { showErrorToast, showSuccessToast } from '@/lib/toast';
import type { BudgetCategory, CategoryGroup } from '@/lib/types';

interface Props {
  category?: BudgetCategory;
  groups: CategoryGroup[];
  defaultGroupId?: string;
  onSaved: () => void;
  onCancel: () => void;
}

export default function CategoryForm({
  category,
  groups,
  defaultGroupId,
  onSaved,
  onCancel,
}: Props) {
  const isEditing = !!category;
  const [name, setName] = useState(category?.name ?? '');
  const [groupId, setGroupId] = useState(
    category?.groupId ?? defaultGroupId ?? groups[0]?._id ?? '',
  );
  // Income flag is create-only: the update endpoint rejects isIncome because
  // flipping it would reclassify historical actuals.
  const [isIncome, setIsIncome] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (isEditing) {
        await updateCategory(category._id, { name, groupId });
        showSuccessToast('Category updated');
      } else {
        await createCategory({ name, groupId, isIncome });
        showSuccessToast('Category created');
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

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 max-w-md border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-800"
    >
      <h2 className="text-lg font-semibold">
        {isEditing ? 'Edit category' : 'New category'}
      </h2>

      <div>
        <label htmlFor="category-name" className="block text-sm font-medium mb-1">
          Name
        </label>
        <input
          id="category-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700"
        />
      </div>

      <div>
        <label htmlFor="category-group" className="block text-sm font-medium mb-1">
          Group
        </label>
        <select
          id="category-group"
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
          className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700"
        >
          {groups.map((g) => (
            <option key={g._id} value={g._id}>
              {g.name}
            </option>
          ))}
        </select>
      </div>

      {!isEditing && (
        <div className="flex items-center gap-2">
          <input
            id="category-is-income"
            type="checkbox"
            checked={isIncome}
            onChange={(e) => setIsIncome(e.target.checked)}
            className="h-4 w-4"
          />
          <label htmlFor="category-is-income" className="text-sm font-medium">
            Income category
          </label>
        </div>
      )}

      {error && <p className="text-red-500 text-sm">{error}</p>}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Saving...' : isEditing ? 'Update' : 'Create'}
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
