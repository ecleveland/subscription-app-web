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
  page?: number;
  limit?: number;
}

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
