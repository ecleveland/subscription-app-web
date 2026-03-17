'use client';

import { useState } from 'react';
import { CATEGORIES } from '@/lib/types';

interface BulkActionToolbarProps {
  selectedCount: number;
  totalCount: number;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onBulkDelete: () => void;
  onBulkActivate: () => void;
  onBulkDeactivate: () => void;
  onBulkChangeCategory: (category: string) => void;
  loading: boolean;
}

export default function BulkActionToolbar({
  selectedCount,
  totalCount,
  onSelectAll,
  onDeselectAll,
  onBulkDelete,
  onBulkActivate,
  onBulkDeactivate,
  onBulkChangeCategory,
  loading,
}: BulkActionToolbarProps) {
  const [category, setCategory] = useState('');
  const allSelected = selectedCount === totalCount;

  return (
    <div className="flex flex-wrap items-center gap-2 p-3 mb-4 rounded-lg bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800">
      <span className="text-sm font-medium text-blue-800 dark:text-blue-200">
        {selectedCount} selected
      </span>

      <button
        onClick={allSelected ? onDeselectAll : onSelectAll}
        disabled={loading}
        className="text-sm text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
      >
        {allSelected ? 'Deselect all' : 'Select all'}
      </button>

      <div className="flex-1" />

      <button
        onClick={onBulkActivate}
        disabled={loading}
        className="px-3 py-1.5 text-sm rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
      >
        Activate
      </button>

      <button
        onClick={onBulkDeactivate}
        disabled={loading}
        className="px-3 py-1.5 text-sm rounded-lg bg-yellow-600 text-white hover:bg-yellow-700 disabled:opacity-50"
      >
        Deactivate
      </button>

      <div className="flex items-center gap-1">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          disabled={loading}
          className="px-2 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-50"
        >
          <option value="">Category...</option>
          {CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>
        <button
          onClick={() => {
            if (category) onBulkChangeCategory(category);
          }}
          disabled={loading || !category}
          className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Apply
        </button>
      </div>

      <button
        onClick={onBulkDelete}
        disabled={loading}
        className="px-3 py-1.5 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
      >
        Delete
      </button>
    </div>
  );
}
