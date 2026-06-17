vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from '@/lib/api';
import {
  getMyHousehold,
  updateHousehold,
  listMembers,
  inviteMember,
  acceptInvitation,
  removeMember,
} from '../households';

describe('households API wrappers', () => {
  afterEach(() => vi.clearAllMocks());

  it('getMyHousehold GETs /households/me', () => {
    void getMyHousehold();
    expect(apiFetch).toHaveBeenCalledWith('/households/me');
  });

  it('updateHousehold PATCHes the active household', () => {
    void updateHousehold({ name: 'New', currency: 'EUR' });
    expect(apiFetch).toHaveBeenCalledWith('/households/me', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'New', currency: 'EUR' }),
    });
  });

  it('listMembers GETs the members', () => {
    void listMembers();
    expect(apiFetch).toHaveBeenCalledWith('/households/me/members');
  });

  it('inviteMember POSTs email + role', () => {
    void inviteMember({ email: 'a@b.com', role: 'adult' });
    expect(apiFetch).toHaveBeenCalledWith('/households/me/invitations', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.com', role: 'adult' }),
    });
  });

  it('acceptInvitation POSTs the token to the accept route', () => {
    void acceptInvitation('tok-1');
    expect(apiFetch).toHaveBeenCalledWith('/households/invitations/accept', {
      method: 'POST',
      body: JSON.stringify({ token: 'tok-1' }),
    });
  });

  it('removeMember DELETEs the member by id', () => {
    void removeMember('m1');
    expect(apiFetch).toHaveBeenCalledWith('/households/me/members/m1', {
      method: 'DELETE',
    });
  });
});
