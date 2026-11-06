'use client';

import { useState, type FormEvent } from 'react';
import {
  RESERVED_LABEL_NAME_ERROR,
  createLabel,
  defaultLabelColor,
  isReservedLabelName,
  updateLabel,
} from '@/lib/labels';
import { showErrorToast, showSuccessToast } from '@/lib/toast';
import type { Label } from '@/lib/types';

interface Props {
  label?: Label;
  // Number of labels the household already has. Seeds the default color.
  existingCount?: number;
  onSaved: () => void;
  onCancel: () => void;
}

export default function LabelForm({
  label,
  existingCount,
  onSaved,
  onCancel,
}: Props) {
  const isEditing = !!label;
  const [name, setName] = useState(label?.name ?? '');
  const [color, setColor] = useState(
    label?.color ?? defaultLabelColor(existingCount ?? 0),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (isReservedLabelName(name)) {
      setError(RESERVED_LABEL_NAME_ERROR);
      return;
    }
    setError('');
    setLoading(true);
    try {
      if (isEditing) {
        await updateLabel(label._id, { name, color });
        showSuccessToast('Label updated');
      } else {
        await createLabel({ name, color });
        showSuccessToast('Label created');
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
      <h2 className="section-title">{isEditing ? 'Edit label' : 'New label'}</h2>

      <div>
        <label htmlFor="label-name" className="label">
          Name
        </label>
        <input
          id="label-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="input"
        />
      </div>

      <div>
        <label htmlFor="label-color" className="label">
          Color
        </label>
        <input
          id="label-color"
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="h-9 w-14 cursor-pointer rounded-md border border-line bg-surface"
        />
      </div>

      {error && <p className="text-danger text-sm">{error}</p>}

      <div className="flex gap-3">
        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? 'Saving...' : isEditing ? 'Update' : 'Create'}
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary">
          Cancel
        </button>
      </div>
    </form>
  );
}
