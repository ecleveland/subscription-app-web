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
  // Income flag is create-only — see updateCategory in lib/categories.ts.
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
      className="space-y-4 max-w-md border border-line rounded-md p-4 bg-surface"
    >
      <h2 className="section-title">
        {isEditing ? 'Edit category' : 'New category'}
      </h2>

      <div>
        <label htmlFor="category-name" className="label">
          Name
        </label>
        <input
          id="category-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="input"
        />
      </div>

      <div>
        <label htmlFor="category-group" className="label">
          Group
        </label>
        <select
          id="category-group"
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
          className="input"
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

      {error && <p className="text-danger text-sm">{error}</p>}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={loading}
          className="btn-primary"
        >
          {loading ? 'Saving...' : isEditing ? 'Update' : 'Create'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="btn-secondary"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
