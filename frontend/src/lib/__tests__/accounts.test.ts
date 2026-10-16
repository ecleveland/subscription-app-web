vi.mock('../api', () => ({ apiFetch: vi.fn() }));

import { apiFetch } from '../api';
import {
  listAccounts,
  getAccount,
  createAccount,
  updateAccount,
  archiveAccount,
} from '../accounts';
import {
  ACCOUNT_TYPES,
  ASSET_ACCOUNT_TYPES,
  LIABILITY_ACCOUNT_TYPES,
  accountTypesInSameClass,
} from '../types';

describe('accounts api wrappers', () => {
  afterEach(() => vi.clearAllMocks());

  it('listAccounts calls GET /accounts and toggles includeArchived', async () => {
    await listAccounts();
    expect(apiFetch).toHaveBeenCalledWith('/accounts');
    await listAccounts(true);
    expect(apiFetch).toHaveBeenCalledWith('/accounts?includeArchived=true');
  });

  it('getAccount calls GET /accounts/:id', async () => {
    await getAccount('a1');
    expect(apiFetch).toHaveBeenCalledWith('/accounts/a1');
  });

  it('createAccount POSTs the body', async () => {
    await createAccount({ name: 'Checking', type: 'checking', balanceCents: 1000 });
    expect(apiFetch).toHaveBeenCalledWith('/accounts', {
      method: 'POST',
      body: JSON.stringify({ name: 'Checking', type: 'checking', balanceCents: 1000 }),
    });
  });

  it('updateAccount PATCHes the body', async () => {
    await updateAccount('a1', { name: 'Renamed' });
    expect(apiFetch).toHaveBeenCalledWith('/accounts/a1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Renamed' }),
    });
  });

  it('archiveAccount DELETEs', async () => {
    await archiveAccount('a1');
    expect(apiFetch).toHaveBeenCalledWith('/accounts/a1', { method: 'DELETE' });
  });
});

describe('account type classes', () => {
  it('returns the four asset types for an asset account', () => {
    expect(accountTypesInSameClass('savings')).toEqual([
      'checking',
      'savings',
      'cash',
      'investment',
    ]);
  });

  it('returns credit and loan for a liability account', () => {
    expect(accountTypesInSameClass('loan')).toEqual(['credit', 'loan']);
  });

  it('splits all six types into the two classes with no overlap', () => {
    const combined = [...ASSET_ACCOUNT_TYPES, ...LIABILITY_ACCOUNT_TYPES];
    expect(new Set(combined).size).toBe(combined.length);
    expect([...combined].sort()).toEqual([...ACCOUNT_TYPES].sort());
  });
});
