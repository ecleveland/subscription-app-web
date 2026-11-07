import { apiFetch } from './api';
import type { Label } from './types';

// Query value for "records with no label". Personal is the absence of a
// label, so there is no Personal record to filter by id.
export const LABEL_FILTER_NONE = 'none';

// Personal is the absence of a label, so a label with that name would read as
// two Personal choices in every picker.
export const RESERVED_LABEL_NAME = 'Personal';

export function isReservedLabelName(name: string): boolean {
  return name.trim().toLowerCase() === RESERVED_LABEL_NAME.toLowerCase();
}

export const RESERVED_LABEL_NAME_ERROR = `"${RESERVED_LABEL_NAME}" is the built-in default and cannot be a label name`;

// The API accepts six digit hex. Lowercase matches what a color input
// reports, so a saved color round trips unchanged.
export const LABEL_COLORS = [
  '#2f8a93',
  '#6b4f9e',
  '#c29a2a',
  '#b5523b',
  '#3f7a4a',
  '#3b5f9e',
  '#a14d7a',
  '#6b6358',
] as const;

// Seeds the color for a new label so consecutive labels look different.
export function defaultLabelColor(existingCount: number): string {
  return LABEL_COLORS[existingCount % LABEL_COLORS.length];
}

// The API lists labels by name. A label created inline goes into its sorted
// place, so pickers and filters keep that order without a refetch.
// Picks black or white text for a label colored background. Falls back to
// white when the color is not a hex string, since the palette is dark enough
// for that to be the usual case.
export function labelTextColor(hex: string): string {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return '#ffffff';
  let digits = match[1];
  if (digits.length === 3) {
    digits = digits
      .split('')
      .map((d) => d + d)
      .join('');
  }
  const r = parseInt(digits.slice(0, 2), 16);
  const g = parseInt(digits.slice(2, 4), 16);
  const b = parseInt(digits.slice(4, 6), 16);
  // Perceived luminance, same weighting the chip colors were picked against.
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#111111' : '#ffffff';
}

export function withLabel(labels: Label[], label: Label): Label[] {
  return [...labels, label].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  );
}

export function listLabels(includeArchived = false): Promise<Label[]> {
  const query = includeArchived ? '?includeArchived=true' : '';
  return apiFetch<Label[]>(`/labels${query}`);
}

export function createLabel(data: {
  name: string;
  color: string;
}): Promise<Label> {
  return apiFetch<Label>('/labels', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateLabel(
  id: string,
  data: { name?: string; color?: string; isArchived?: boolean },
): Promise<Label> {
  return apiFetch<Label>(`/labels/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

// The backend archives a label that records still reference and deletes an
// unused one. The outcome says which happened.
export function deleteLabel(
  id: string,
): Promise<{ outcome: 'archived' | 'deleted' }> {
  return apiFetch<{ outcome: 'archived' | 'deleted' }>(`/labels/${id}`, {
    method: 'DELETE',
  });
}
