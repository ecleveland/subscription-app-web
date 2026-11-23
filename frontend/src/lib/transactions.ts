import { apiFetch } from './api';
import type { ColumnMapping } from './csv';
import type {
  Transaction,
  TransactionType,
  PaginatedResponse,
  ImportResult,
} from './types';

export interface ImportTransactionsInput {
  accountId: string;
  mapping: ColumnMapping;
  rows: Record<string, string>[];
}

export interface TransactionFilters {
  accountId?: string;
  categoryId?: string;
  recurringId?: string;
  type?: TransactionType;
  dateFrom?: string;
  dateTo?: string;
  cleared?: boolean;
  // A label id, LABEL_FILTER_NONE for personal records or LABEL_FILTER_ANY
  // for every labeled record.
  labelId?: string;
  page?: number;
  limit?: number;
}

// Owed marks an expense reimbursable. Reimbursed records the day the money
// came back and, optionally, the income transaction that paid it.
export type ReimbursementInput =
  | { status: 'owed' }
  | {
      status: 'reimbursed';
      reimbursedAt: string;
      reimbursedByTransactionId?: string;
    };

export interface TransactionInput {
  accountId: string;
  type: TransactionType;
  amountCents: number;
  date: string;
  categoryId?: string;
  transferAccountId?: string;
  payee?: string;
  notes?: string;
  cleared?: boolean;
  // Null clears the label, which makes the record personal.
  labelId?: string | null;
  // Null clears the reimbursement block on edit.
  reimbursement?: ReimbursementInput | null;
}

function toQuery(filters: TransactionFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '' && value !== null) {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function listTransactions(
  filters: TransactionFilters = {},
): Promise<PaginatedResponse<Transaction>> {
  return apiFetch<PaginatedResponse<Transaction>>(
    `/transactions${toQuery(filters)}`,
  );
}

export function createTransaction(
  data: TransactionInput,
): Promise<Transaction> {
  return apiFetch<Transaction>('/transactions', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateTransaction(
  id: string,
  data: Partial<TransactionInput>,
): Promise<Transaction> {
  return apiFetch<Transaction>(`/transactions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function setReimbursement(
  id: string,
  block: ReimbursementInput,
): Promise<Transaction> {
  return updateTransaction(id, { reimbursement: block });
}

export function deleteTransaction(id: string): Promise<void> {
  return apiFetch<void>(`/transactions/${id}`, { method: 'DELETE' });
}

/** Bulk-import parsed CSV rows into an account via `POST /transactions/import`. */
export function importTransactions(
  input: ImportTransactionsInput,
): Promise<ImportResult> {
  return apiFetch<ImportResult>('/transactions/import', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
