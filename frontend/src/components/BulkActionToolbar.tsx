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
    <div className="flex flex-wrap items-center gap-2 p-3 mb-4 rounded-md bg-accent-soft border border-accent/40">
      <span className="text-sm font-medium text-accent">
        {selectedCount} selected
      </span>

      <button
        onClick={allSelected ? onDeselectAll : onSelectAll}
        disabled={loading}
        className="text-sm text-accent hover:underline disabled:opacity-50"
      >
        {allSelected ? 'Deselect all' : 'Select all'}
      </button>

      <div className="flex-1" />

      <button
        onClick={onBulkActivate}
        disabled={loading}
        className="btn-primary"
      >
        Activate
      </button>

      <button
        onClick={onBulkDeactivate}
        disabled={loading}
        className="px-3 py-1.5 text-sm rounded-md bg-warn text-white hover:bg-warn/90 disabled:opacity-50"
      >
        Deactivate
      </button>

      <div className="flex items-center gap-1">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          disabled={loading}
          className="btn-secondary px-2 py-1.5"
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
          className="btn-primary"
        >
          Apply
        </button>
      </div>

      <button
        onClick={onBulkDelete}
        disabled={loading}
        className="px-3 py-1.5 text-sm rounded-md bg-danger text-white hover:bg-danger-strong disabled:opacity-50"
      >
        Delete
      </button>
    </div>
  );
}
