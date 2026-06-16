import type { AuthenticatedRequest } from '../../auth/interfaces/jwt-payload.interface';
import type { HouseholdRole } from '../schemas/household-member.schema';

// The active-household context that HouseholdGuard resolves and attaches to the
// request, analogous to how JwtStrategy attaches `user`. Downstream
// household-scoped controllers read `req.household` instead of `req.user`.
export interface HouseholdContext {
  householdId: string;
  // The HouseholdMember document id — used for "who did it" attribution on
  // household-scoped records (e.g. Transaction.memberId).
  memberId: string;
  role: HouseholdRole;
}

export interface HouseholdRequest extends AuthenticatedRequest {
  household: HouseholdContext;
}
