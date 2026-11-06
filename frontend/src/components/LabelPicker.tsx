'use client';

import { useRef, useState, type KeyboardEvent } from 'react';
import {
  RESERVED_LABEL_NAME_ERROR,
  createLabel,
  defaultLabelColor,
  isReservedLabelName,
} from '@/lib/labels';
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
  // The value on the record when the form opened. Options and layout key on
  // it, so picking another label mid-edit neither drops an archived saved
  // label nor flips the control between radios and a select.
  const [savedId] = useState(value);
  // Bumped by closeRow. A create that resolves after Cancel still reaches the
  // parent's list, because the label exists on the server, but is not picked.
  const attemptRef = useRef(0);

  // Archived labels stay out of the picker, except the one already on the
  // record, so an edit form never shows a blank value.
  const options = labels.filter((l) => !l.isArchived || l._id === savedId);
  // A saved id missing from the list gets a placeholder option, as GoalForm
  // does for a missing category, so the select never shows Personal for it.
  const missingId =
    savedId !== null && !labels.some((l) => l._id === savedId) ? savedId : null;
  const useRadios = options.length <= 1 && missingId === null;
  const labelId = `${id}-label`;

  function openRow() {
    setNewName('');
    setNewColor(defaultLabelColor(labels.length));
    setError('');
    setAdding(true);
  }

  function closeRow() {
    attemptRef.current += 1;
    setSaving(false);
    setAdding(false);
    setNewName('');
    setError('');
  }

  async function handleAdd() {
    const name = newName.trim();
    if (!name || saving || disabled) return;
    if (isReservedLabelName(name)) {
      setError(RESERVED_LABEL_NAME_ERROR);
      return;
    }
    const attempt = attemptRef.current;
    const isCurrent = () => attempt === attemptRef.current;
    setSaving(true);
    setError('');
    try {
      const label = await createLabel({ name, color: newColor });
      onCreated(label);
      if (!isCurrent()) return;
      onChange(label._id);
      closeRow();
    } catch (err) {
      if (!isCurrent()) return;
      const message = err instanceof Error ? err.message : 'Something went wrong';
      setError(message);
      showErrorToast(message);
    } finally {
      if (isCurrent()) setSaving(false);
    }
  }

  // The picker sits inside other forms, so Enter must add the label rather
  // than submit the outer form.
  function handleNameKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    // Enter during an IME composition confirms the composed text.
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      void handleAdd();
    }
  }

  // Native radios give one tab stop and arrow-key selection. The input is
  // transparent and covers its label, so a click anywhere on the segment
  // lands on the input itself. An sr-only input would leave the label
  // intercepting Playwright's clicks.
  function renderRadio(optionValue: string | null, text: string) {
    const checked = value === optionValue;
    return (
      <label
        key={optionValue ?? ''}
        className={`${checked ? 'btn-primary' : 'btn-secondary'} relative cursor-pointer has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent`}
      >
        <input
          type="radio"
          name={id}
          value={optionValue ?? ''}
          checked={checked}
          disabled={disabled}
          onChange={() => onChange(optionValue)}
          className="absolute inset-0 m-0 cursor-pointer appearance-none opacity-0 disabled:cursor-not-allowed"
        />
        {text}
      </label>
    );
  }

  return (
    <div>
      {useRadios ? (
        <>
          <span id={labelId} className="label">
            Label
          </span>
          <div
            role="radiogroup"
            aria-labelledby={labelId}
            className="flex flex-wrap gap-2"
          >
            {renderRadio(null, 'Personal')}
            {options.map((l) =>
              renderRadio(l._id, l.isArchived ? `${l.name} (archived)` : l.name),
            )}
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
            {missingId !== null && (
              <option value={missingId} disabled>
                Current label (unavailable)
              </option>
            )}
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
            aria-label="Add new label"
            className="btn-primary"
          >
            Add
          </button>
          <button
            type="button"
            onClick={closeRow}
            aria-label="Cancel new label"
            className="btn-secondary"
          >
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
