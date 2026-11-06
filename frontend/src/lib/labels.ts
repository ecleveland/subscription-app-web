import { apiFetch } from './api';
import type { Label } from './types';

// Query value for "records with no label". Personal is the absence of a
// label, so there is no Personal record to filter by id.
export const LABEL_FILTER_NONE = 'none';

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
