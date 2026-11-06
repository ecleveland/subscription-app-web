'use client';

import { useState, type KeyboardEvent } from 'react';
import { createLabel, defaultLabelColor } from '@/lib/labels';
import { showErrorToast } from '@/lib/toast';
import type { Label } from '@/lib/types';

interface Props {
  // Id of the control. The "Label" heading uses `${id}-label`.
  id: string;
  // Full list, archived included.
  labels: Label[];
  // Null is Personal.
  value: string | null;
  onChange: (labelId: string | null) => void;
  // The parent appends the new label to its list.
  onCreated: (label: Label) => void;
  disabled?: boolean;
}

export default function LabelPicker({
  id,
  labels,
  value,
  onChange,
  onCreated,
  disabled = false,
}: Props) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(() =>
    defaultLabelColor(labels.length),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Archived labels stay out of the picker, except the one already on the
  // record, so an edit form never shows a blank value.
  const options = labels.filter((l) => !l.isArchived || l._id === value);
  const labelId = `${id}-label`;

  function openRow() {
    setNewName('');
    setNewColor(defaultLabelColor(labels.length));
    setError('');
    setAdding(true);
  }

  function closeRow() {
    setAdding(false);
    setNewName('');
    setError('');
  }

  async function handleAdd() {
    const name = newName.trim();
    if (!name || saving || disabled) return;
    setSaving(true);
    setError('');
    try {
      const label = await createLabel({ name, color: newColor });
      onCreated(label);
      onChange(label._id);
      closeRow();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong';
      setError(message);
      showErrorToast(message);
    } finally {
      setSaving(false);
    }
  }

  // The picker sits inside other forms, so Enter must add the label rather
  // than submit the outer form.
  function handleNameKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      void handleAdd();
    }
  }

  return (
    <div>
      {options.length <= 1 ? (
        <>
          <span id={labelId} className="label">
            Label
          </span>
          <div
            role="radiogroup"
            aria-labelledby={labelId}
            className="flex flex-wrap gap-2"
          >
            <button
              type="button"
              role="radio"
              aria-checked={value === null}
              disabled={disabled}
              onClick={() => onChange(null)}
              className={value === null ? 'btn-primary' : 'btn-secondary'}
            >
              Personal
            </button>
            {options.map((l) => (
              <button
                key={l._id}
                type="button"
                role="radio"
                aria-checked={value === l._id}
                disabled={disabled}
                onClick={() => onChange(l._id)}
                className={value === l._id ? 'btn-primary' : 'btn-secondary'}
              >
                {l.isArchived ? `${l.name} (archived)` : l.name}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <label id={labelId} htmlFor={id} className="label">
            Label
          </label>
          <select
            id={id}
            value={value ?? ''}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value || null)}
            className="input"
          >
            <option value="">Personal</option>
            {options.map((l) => (
              <option key={l._id} value={l._id}>
                {l.isArchived ? `${l.name} (archived)` : l.name}
              </option>
            ))}
          </select>
        </>
      )}

      {adding ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            aria-label="New label name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={handleNameKeyDown}
            className="input flex-1"
            autoFocus
          />
          <input
            type="color"
            aria-label="New label color"
            value={newColor}
            onChange={(e) => setNewColor(e.target.value)}
            className="h-9 w-10 cursor-pointer rounded-md border border-line bg-surface"
          />
          <button
            type="button"
            onClick={() => void handleAdd()}
            disabled={disabled || saving}
            className="btn-primary"
          >
            Add
          </button>
          <button type="button" onClick={closeRow} className="btn-secondary">
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={openRow}
          disabled={disabled}
          className="mt-2 text-sm text-accent hover:underline disabled:cursor-not-allowed disabled:opacity-50"
        >
          Add a label
        </button>
      )}

      {error && <p className="text-danger text-sm mt-1">{error}</p>}
    </div>
  );
}
