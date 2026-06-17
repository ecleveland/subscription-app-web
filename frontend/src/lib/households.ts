import { apiFetch } from './api';
import type {
  Household,
  HouseholdMember,
  HouseholdWithMembers,
  InviteResult,
  InviteRole,
} from './types';

/** The caller's active household plus its members. */
export function getMyHousehold(): Promise<HouseholdWithMembers> {
  return apiFetch<HouseholdWithMembers>('/households/me');
}

/** Update the active household's name/currency (owner only). */
export function updateHousehold(data: {
  name?: string;
  currency?: string;
}): Promise<Household> {
  return apiFetch<Household>('/households/me', {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

/** List the active household's members. */
export function listMembers(): Promise<HouseholdMember[]> {
  return apiFetch<HouseholdMember[]>('/households/me/members');
}

/** Invite a member by email (owner only). Returns a shareable invite link. */
export function inviteMember(data: {
  email: string;
  role?: InviteRole;
}): Promise<InviteResult> {
  return apiFetch<InviteResult>('/households/me/invitations', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/** Accept an invitation by its raw token. */
export function acceptInvitation(token: string): Promise<HouseholdMember> {
  return apiFetch<HouseholdMember>('/households/invitations/accept', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
}

/** Remove a member from the active household (owner only). */
export function removeMember(memberId: string): Promise<void> {
  return apiFetch<void>(`/households/me/members/${memberId}`, {
    method: 'DELETE',
  });
}
