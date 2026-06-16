import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { HouseholdGuard } from './household.guard';
import { HouseholdsService } from '../households.service';
import {
  HouseholdRole,
  MembershipStatus,
} from '../schemas/household-member.schema';

const USER_ID = '507f1f77bcf86cd799439011';
const MEMBER_ID = '507f191e810c19729de86aaa';
const HOUSEHOLD_A = '507f191e810c19729de860ea';
const HOUSEHOLD_B = '507f191e810c19729de860bb';

function createMockContext(request: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function activeMembership() {
  return {
    _id: new Types.ObjectId(MEMBER_ID),
    householdId: new Types.ObjectId(HOUSEHOLD_A),
    userId: new Types.ObjectId(USER_ID),
    role: HouseholdRole.OWNER,
    status: MembershipStatus.ACTIVE,
  };
}

describe('HouseholdGuard', () => {
  let guard: HouseholdGuard;
  let householdsService: { findMembershipByUser: jest.Mock };

  beforeEach(() => {
    householdsService = { findMembershipByUser: jest.fn() };
    guard = new HouseholdGuard(
      householdsService as unknown as HouseholdsService,
    );
  });

  it('resolves the active household and attaches it to the request', async () => {
    householdsService.findMembershipByUser.mockResolvedValue(
      activeMembership(),
    );
    const request: any = {
      user: { userId: USER_ID, username: 'tester', role: 'user' },
    };

    await expect(guard.canActivate(createMockContext(request))).resolves.toBe(
      true,
    );

    expect(householdsService.findMembershipByUser).toHaveBeenCalledWith(
      USER_ID,
    );
    expect(request.household).toEqual({
      householdId: HOUSEHOLD_A,
      memberId: MEMBER_ID,
      role: HouseholdRole.OWNER,
    });
  });

  it('throws ForbiddenException when the user has no active membership', async () => {
    householdsService.findMembershipByUser.mockResolvedValue(null);
    const request: any = { user: { userId: USER_ID } };

    await expect(
      guard.canActivate(createMockContext(request)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(request.household).toBeUndefined();
  });

  it('throws ForbiddenException (fails closed) when req.user is missing', async () => {
    const request: any = {};

    await expect(
      guard.canActivate(createMockContext(request)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(householdsService.findMembershipByUser).not.toHaveBeenCalled();
  });

  it('propagates a service/DB error as a denial and never attaches a household (fail closed)', async () => {
    householdsService.findMembershipByUser.mockRejectedValue(
      new Error('mongo down'),
    );
    const request: any = { user: { userId: USER_ID } };

    await expect(guard.canActivate(createMockContext(request))).rejects.toThrow(
      'mongo down',
    );
    expect(request.household).toBeUndefined();
  });

  it('rejects a non-active (invited) membership even if the service returns one', async () => {
    householdsService.findMembershipByUser.mockResolvedValue({
      ...activeMembership(),
      status: MembershipStatus.INVITED,
    });
    const request: any = { user: { userId: USER_ID } };

    await expect(
      guard.canActivate(createMockContext(request)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(request.household).toBeUndefined();
  });

  it('propagates the membership role and memberId (not hardcoded to owner)', async () => {
    householdsService.findMembershipByUser.mockResolvedValue({
      ...activeMembership(),
      role: HouseholdRole.ADULT,
    });
    const request: any = { user: { userId: USER_ID } };

    await guard.canActivate(createMockContext(request));

    expect(request.household.role).toBe(HouseholdRole.ADULT);
    expect(request.household.memberId).toBe(MEMBER_ID);
    expect(request.household.householdId).toBe(HOUSEHOLD_A);
  });

  it('ignores a client-supplied householdId and resolves strictly from the authenticated user (cross-household isolation)', async () => {
    // User belongs to household A; the request tries to spoof household B via
    // body/params/query. The guard must resolve A from the userId and never
    // honor the client-supplied B.
    householdsService.findMembershipByUser.mockResolvedValue(
      activeMembership(),
    );
    const request: any = {
      user: { userId: USER_ID },
      body: { householdId: HOUSEHOLD_B },
      params: { householdId: HOUSEHOLD_B },
      query: { householdId: HOUSEHOLD_B },
    };

    await guard.canActivate(createMockContext(request));

    expect(householdsService.findMembershipByUser).toHaveBeenCalledWith(
      USER_ID,
    );
    expect(householdsService.findMembershipByUser).not.toHaveBeenCalledWith(
      HOUSEHOLD_B,
    );
    expect(request.household.householdId).toBe(HOUSEHOLD_A);
  });
});
