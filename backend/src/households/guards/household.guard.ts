import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { HouseholdsService } from '../households.service';
import { MembershipStatus } from '../schemas/household-member.schema';
import type { AuthenticatedRequest } from '../../auth/interfaces/jwt-payload.interface';
import type { HouseholdRequest } from '../interfaces/household-request.interface';

/**
 * Resolves the caller's active household from their membership and attaches it
 * to the request as `req.household`. Must run after `JwtAuthGuard` (it relies on
 * `req.user`). Rejects callers with no active membership.
 *
 * The household is resolved strictly from the authenticated `userId` — a
 * client-supplied householdId (body/params/query) is never trusted, so a member
 * of one household cannot act on another's data.
 */
@Injectable()
export class HouseholdGuard implements CanActivate {
  constructor(private readonly householdsService: HouseholdsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userId = request.user?.userId;
    if (!userId) {
      // JwtAuthGuard should have populated req.user; if not, fail closed.
      throw new ForbiddenException('Not authenticated');
    }

    const membership =
      await this.householdsService.findMembershipByUser(userId);
    // Re-assert ACTIVE at the security boundary so the guard's guarantee doesn't
    // rely solely on the service's query filter staying correct over time.
    if (!membership || membership.status !== MembershipStatus.ACTIVE) {
      throw new ForbiddenException('No active household membership');
    }

    (request as HouseholdRequest).household = {
      householdId: (
        membership.householdId as unknown as Types.ObjectId
      ).toString(),
      memberId: membership._id.toString(),
      role: membership.role,
    };
    return true;
  }
}
