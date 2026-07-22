import { apiFetch } from './api';
import { daysUntil, formatCents } from './utils';
import type {
  RecurringTransaction,
  RecurringType,
  RecurringCadence,
} from './types';

export interface RecurringFilters {
  type?: RecurringType;
  accountId?: string;
  categoryId?: string;
  isSubscription?: boolean;
  isActive?: boolean;
}

export interface RecurringInput {
  accountId: string;
  categoryId: string;
  type: RecurringType;
  amountCents: number;
  payee: string;
  cadence: RecurringCadence;
  nextDate: string;
  notes?: string;
  tags?: string[];
  reminderDaysBefore?: number;
  // `null` clears an existing end date on edit.
  endDate?: string | null;
  isActive?: boolean;
  // Expenses only — the server rejects an income schedule flagged true.
  isSubscription?: boolean;
  sharedWith?: number | null;
}

function toQuery(filters: RecurringFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '' && value !== null) {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/** List the household's recurring schedules (plain array, sorted by nextDate asc). */
export function listRecurring(
  filters: RecurringFilters = {},
): Promise<RecurringTransaction[]> {
  return apiFetch<RecurringTransaction[]>(`/recurring${toQuery(filters)}`);
}

export function createRecurring(
  data: RecurringInput,
): Promise<RecurringTransaction> {
  return apiFetch<RecurringTransaction>('/recurring', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateRecurring(
  id: string,
  data: Partial<RecurringInput>,
): Promise<RecurringTransaction> {
  return apiFetch<RecurringTransaction>(`/recurring/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function deleteRecurring(id: string): Promise<void> {
  return apiFetch<void>(`/recurring/${id}`, { method: 'DELETE' });
}

// --- Pure, framework-free display/logic helpers -----------------------------

/**
 * The active schedules due within the next `days` days (today through +days,
 * inclusive), for the "upcoming bills" view. Paused schedules never surface.
 * Day-granular and timezone-stable via `daysUntil`.
 */
export function upcomingWithin(
  schedules: RecurringTransaction[],
  days: number,
): RecurringTransaction[] {
  return schedules.filter((r) => {
    if (!r.isActive) return false;
    const d = daysUntil(r.nextDate);
    return d >= 0 && d <= days;
  });
}

/** Signed currency string: income `+$X`, expense `-$X`. */
export function signedCents(type: RecurringType, amountCents: number): string {
  const formatted = formatCents(amountCents);
  return type === 'income' ? `+${formatted}` : `-${formatted}`;
}

/** Human label for a cadence, e.g. `monthly` → `Monthly`. */
export function cadenceLabel(cadence: RecurringCadence): string {
  return cadence.charAt(0).toUpperCase() + cadence.slice(1);
}
