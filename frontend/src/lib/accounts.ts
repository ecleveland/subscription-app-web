import { apiFetch } from './api';
import type { Account, AccountType } from './types';

export function listAccounts(includeArchived = false): Promise<Account[]> {
  const query = includeArchived ? '?includeArchived=true' : '';
  return apiFetch<Account[]>(`/accounts${query}`);
}

export function getAccount(id: string): Promise<Account> {
  return apiFetch<Account>(`/accounts/${id}`);
}

export function createAccount(data: {
  name: string;
  type: AccountType;
  balanceCents?: number;
}): Promise<Account> {
  return apiFetch<Account>('/accounts', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateAccount(
  id: string,
  data: { name?: string; type?: AccountType; isArchived?: boolean },
): Promise<Account> {
  return apiFetch<Account>(`/accounts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

/** Archive (soft-delete) an account. */
export function archiveAccount(id: string): Promise<void> {
  return apiFetch<void>(`/accounts/${id}`, { method: 'DELETE' });
}
