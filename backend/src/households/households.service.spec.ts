import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { HouseholdsService } from './households.service';
import { Household } from './schemas/household.schema';
import {
  HouseholdMember,
  HouseholdRole,
  MembershipStatus,
} from './schemas/household-member.schema';
import { Invitation, InvitationStatus } from './schemas/invitation.schema';
import { User } from '../users/schemas/user.schema';
import { MAIL_SERVICE } from '../mail/mail.service';

const OWNER_ID = '507f1f77bcf86cd799439011';
const HOUSEHOLD_ID = '507f191e810c19729de860ea';
const OTHER_USER_ID = '507f1f77bcf86cd799439099';
const OTHER_HOUSEHOLD_ID = '507f191e810c19729de860eb';
const MEMBER_DOC_ID = '507f191e810c19729de860ec';
const INVITATION_ID = '507f191e810c19729de860ed';

function createChainable(resolvedValue: any = null) {
  const chain: any = {};
  chain.select = jest.fn().mockReturnValue(chain);
  chain.populate = jest.fn().mockReturnValue(chain);
  chain.sort = jest.fn().mockReturnValue(chain);
  chain.exec = jest.fn().mockResolvedValue(resolvedValue);
  return chain;
}

function duplicateKeyError(): Error {
  return Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
}

function ctx(role: HouseholdRole, householdId: string = HOUSEHOLD_ID) {
  return { householdId, memberId: MEMBER_DOC_ID, role };
}

describe('HouseholdsService', () => {
  let service: HouseholdsService;
  let mockHouseholdModel: any;
  let mockMemberModel: any;
  let mockInvitationModel: any;
  let mockUserModel: any;
  let mockMailService: any;
  let householdSave: jest.Mock;
  let memberSave: jest.Mock;
  let invitationSave: jest.Mock;

  beforeEach(async () => {
    householdSave = jest.fn().mockResolvedValue({
      _id: new Types.ObjectId(HOUSEHOLD_ID),
      name: 'Test Household',
      ownerId: new Types.ObjectId(OWNER_ID),
      currency: 'USD',
    });
    memberSave = jest.fn().mockImplementation(function (this: any) {
      return Promise.resolve(this);
    });
    invitationSave = jest.fn().mockImplementation(function (this: any) {
      return Promise.resolve({
        _id: new Types.ObjectId(INVITATION_ID),
        ...this,
      });
    });

    mockHouseholdModel = jest
      .fn()
      .mockImplementation((dto) => ({ ...dto, save: householdSave }));
    mockHouseholdModel.deleteOne = jest
      .fn()
      .mockResolvedValue({ deletedCount: 1 });
    mockHouseholdModel.findById = jest
      .fn()
      .mockReturnValue(
        createChainable({ _id: HOUSEHOLD_ID, name: 'Test Household' }),
      );
    mockHouseholdModel.findByIdAndUpdate = jest
      .fn()
      .mockReturnValue(
        createChainable({ _id: HOUSEHOLD_ID, name: 'New Name' }),
      );

    mockMemberModel = jest
      .fn()
      .mockImplementation((dto) => ({ ...dto, save: memberSave }));
    mockMemberModel.findOne = jest.fn().mockReturnValue(createChainable(null));
    mockMemberModel.findById = jest.fn().mockReturnValue(createChainable(null));
    mockMemberModel.find = jest.fn().mockReturnValue(createChainable([]));
    mockMemberModel.countDocuments = jest
      .fn()
      .mockReturnValue(createChainable(0));
    mockMemberModel.deleteOne = jest
      .fn()
      .mockReturnValue(createChainable({ deletedCount: 1 }));
    mockMemberModel.deleteMany = jest
      .fn()
      .mockReturnValue(createChainable({ deletedCount: 0 }));

    mockInvitationModel = jest
      .fn()
      .mockImplementation((dto) => ({ ...dto, save: invitationSave }));
    mockInvitationModel.findOne = jest
      .fn()
      .mockReturnValue(createChainable(null));
    mockInvitationModel.updateMany = jest
      .fn()
      .mockReturnValue(createChainable({ modifiedCount: 0 }));

    mockUserModel = {
      findOne: jest.fn().mockReturnValue(createChainable(null)),
      findById: jest.fn().mockReturnValue(createChainable(null)),
    };

    mockMailService = {
      sendInvitationEmail: jest.fn().mockResolvedValue(undefined),
      sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HouseholdsService,
        {
          provide: getModelToken(Household.name),
          useValue: mockHouseholdModel,
        },
        {
          provide: getModelToken(HouseholdMember.name),
          useValue: mockMemberModel,
        },
        {
          provide: getModelToken(Invitation.name),
          useValue: mockInvitationModel,
        },
        { provide: getModelToken(User.name), useValue: mockUserModel },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) =>
              key === 'frontendUrl' ? 'http://localhost:3000' : 'test-pepper',
            ),
          },
        },
        { provide: MAIL_SERVICE, useValue: mockMailService },
      ],
    }).compile();

    module.useLogger(false);
    service = module.get<HouseholdsService>(HouseholdsService);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.clearAllMocks());

  describe('createHousehold', () => {
    it('creates the household with the owner and default USD currency', async () => {
      const result = await service.createHousehold(OWNER_ID, {
        name: 'Test Household',
      });

      const householdArgs = mockHouseholdModel.mock.calls[0][0];
      expect(householdArgs.name).toBe('Test Household');
      expect(householdArgs.ownerId.toString()).toBe(OWNER_ID);
      expect(householdArgs.currency).toBe('USD');
      expect(householdSave).toHaveBeenCalledTimes(1);
      expect(result._id.toString()).toBe(HOUSEHOLD_ID);
    });

    it('adds the owner as an active owner member', async () => {
      await service.createHousehold(OWNER_ID, { name: 'Test Household' });

      const memberArgs = mockMemberModel.mock.calls[0][0];
      expect(memberArgs.householdId.toString()).toBe(HOUSEHOLD_ID);
      expect(memberArgs.userId.toString()).toBe(OWNER_ID);
      expect(memberArgs.role).toBe(HouseholdRole.OWNER);
      expect(memberArgs.status).toBe(MembershipStatus.ACTIVE);
      expect(memberArgs.joinedAt).toBeInstanceOf(Date);
      expect(memberSave).toHaveBeenCalledTimes(1);
    });

    it('respects a provided currency', async () => {
      await service.createHousehold(OWNER_ID, {
        name: 'Test Household',
        currency: 'EUR',
      });

      expect(mockHouseholdModel.mock.calls[0][0].currency).toBe('EUR');
    });

    it('deletes the orphaned household and rethrows when owner membership fails', async () => {
      memberSave.mockRejectedValueOnce(new Error('db down'));

      await expect(
        service.createHousehold(OWNER_ID, { name: 'Test Household' }),
      ).rejects.toThrow('db down');

      expect(mockHouseholdModel.deleteOne).toHaveBeenCalledTimes(1);
      expect(mockHouseholdModel.deleteOne.mock.calls[0][0]._id.toString()).toBe(
        HOUSEHOLD_ID,
      );
    });
  });

  describe('addMember', () => {
    it('creates an active member with a joinedAt by default', async () => {
      await service.addMember({
        householdId: HOUSEHOLD_ID,
        userId: OTHER_USER_ID,
        role: HouseholdRole.ADULT,
      });

      const args = mockMemberModel.mock.calls[0][0];
      expect(args.householdId.toString()).toBe(HOUSEHOLD_ID);
      expect(args.userId.toString()).toBe(OTHER_USER_ID);
      expect(args.role).toBe(HouseholdRole.ADULT);
      expect(args.status).toBe(MembershipStatus.ACTIVE);
      expect(args.joinedAt).toBeInstanceOf(Date);
    });

    it('leaves joinedAt unset for invited members', async () => {
      await service.addMember({
        householdId: HOUSEHOLD_ID,
        userId: OTHER_USER_ID,
        role: HouseholdRole.ADULT,
        status: MembershipStatus.INVITED,
      });

      const args = mockMemberModel.mock.calls[0][0];
      expect(args.status).toBe(MembershipStatus.INVITED);
      expect(args.joinedAt).toBeUndefined();
    });

    it('throws ConflictException on a duplicate membership', async () => {
      memberSave.mockRejectedValueOnce(duplicateKeyError());

      await expect(
        service.addMember({
          householdId: HOUSEHOLD_ID,
          userId: OTHER_USER_ID,
          role: HouseholdRole.ADULT,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rethrows non-duplicate errors', async () => {
      memberSave.mockRejectedValueOnce(new Error('db down'));

      await expect(
        service.addMember({
          householdId: HOUSEHOLD_ID,
          userId: OTHER_USER_ID,
          role: HouseholdRole.ADULT,
        }),
      ).rejects.toThrow('db down');
    });

    it('rethrows DB errors carrying a non-duplicate code (not ConflictException)', async () => {
      memberSave.mockRejectedValueOnce(
        Object.assign(new Error('write concern failed'), { code: 64 }),
      );

      const promise = service.addMember({
        householdId: HOUSEHOLD_ID,
        userId: OTHER_USER_ID,
        role: HouseholdRole.ADULT,
      });

      await expect(promise).rejects.toThrow('write concern failed');
      await expect(promise).rejects.not.toBeInstanceOf(ConflictException);
    });
  });

  describe('findMembershipByUser', () => {
    it('queries for the active membership of the user', async () => {
      const membership = { _id: 'm1', userId: OTHER_USER_ID };
      mockMemberModel.findOne.mockReturnValue(createChainable(membership));

      const result = await service.findMembershipByUser(OTHER_USER_ID);

      const filter = mockMemberModel.findOne.mock.calls[0][0];
      expect(filter.userId.toString()).toBe(OTHER_USER_ID);
      expect(filter.status).toBe(MembershipStatus.ACTIVE);
      expect(result).toBe(membership);
    });

    it('returns null when the user has no active membership', async () => {
      mockMemberModel.findOne.mockReturnValue(createChainable(null));

      expect(await service.findMembershipByUser(OTHER_USER_ID)).toBeNull();
    });
  });

  describe('removeMembershipsByUser', () => {
    it('deletes every membership for the user and returns the count', async () => {
      mockMemberModel.deleteMany.mockReturnValue(
        createChainable({ deletedCount: 2 }),
      );

      const result = await service.removeMembershipsByUser(OTHER_USER_ID);

      const filter = mockMemberModel.deleteMany.mock.calls[0][0];
      expect(filter.userId.toString()).toBe(OTHER_USER_ID);
      expect(result).toBe(2);
    });

    it('returns 0 when the user has no memberships', async () => {
      mockMemberModel.deleteMany.mockReturnValue(
        createChainable({ deletedCount: 0 }),
      );

      expect(await service.removeMembershipsByUser(OTHER_USER_ID)).toBe(0);
    });
  });

  describe('getHouseholdWithMembers', () => {
    it('returns the household and its members', async () => {
      const members = [{ _id: 'm1' }];
      mockMemberModel.find.mockReturnValue(createChainable(members));

      const result = await service.getHouseholdWithMembers(HOUSEHOLD_ID);

      expect(result.household).toEqual({
        _id: HOUSEHOLD_ID,
        name: 'Test Household',
      });
      expect(result.members).toBe(members);
    });

    it('throws NotFoundException when the household is missing', async () => {
      mockHouseholdModel.findById.mockReturnValue(createChainable(null));

      await expect(
        service.getHouseholdWithMembers(HOUSEHOLD_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('listMembers', () => {
    it('queries members by household and populates user display fields', async () => {
      const members = [{ _id: 'm1' }];
      const chain = createChainable(members);
      mockMemberModel.find.mockReturnValue(chain);

      const result = await service.listMembers(HOUSEHOLD_ID);

      expect(mockMemberModel.find.mock.calls[0][0].householdId.toString()).toBe(
        HOUSEHOLD_ID,
      );
      expect(chain.populate).toHaveBeenCalledWith(
        'userId',
        'username displayName email',
      );
      expect(result).toBe(members);
    });
  });

  describe('updateHousehold', () => {
    it('updates the household when the caller is the owner', async () => {
      const result = await service.updateHousehold(ctx(HouseholdRole.OWNER), {
        name: 'New Name',
      });

      expect(mockHouseholdModel.findByIdAndUpdate).toHaveBeenCalledWith(
        HOUSEHOLD_ID,
        { name: 'New Name' },
        { new: true, runValidators: true },
      );
      expect(result).toEqual({ _id: HOUSEHOLD_ID, name: 'New Name' });
    });

    it('forbids a non-owner from updating', async () => {
      await expect(
        service.updateHousehold(ctx(HouseholdRole.ADULT), { name: 'New Name' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(mockHouseholdModel.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the household is missing', async () => {
      mockHouseholdModel.findByIdAndUpdate.mockReturnValue(
        createChainable(null),
      );

      await expect(
        service.updateHousehold(ctx(HouseholdRole.OWNER), { name: 'New Name' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('inviteMember', () => {
    it('forbids a non-owner from inviting', async () => {
      await expect(
        service.inviteMember(ctx(HouseholdRole.ADULT), {
          email: 'new@example.com',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects inviting someone who is already an active member', async () => {
      mockUserModel.findOne.mockReturnValue(
        createChainable({ _id: new Types.ObjectId(OTHER_USER_ID) }),
      );
      mockMemberModel.findOne.mockReturnValue(
        createChainable({ _id: 'existing-membership' }),
      );

      await expect(
        service.inviteMember(ctx(HouseholdRole.OWNER), {
          email: 'new@example.com',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('invites a registered user who is not yet a member of this household', async () => {
      mockUserModel.findOne.mockReturnValue(
        createChainable({ _id: new Types.ObjectId(OTHER_USER_ID) }),
      );
      mockMemberModel.findOne.mockReturnValue(createChainable(null)); // not a member

      const invitation = await service.inviteMember(ctx(HouseholdRole.OWNER), {
        email: 'registered@example.com',
      });

      expect(mockInvitationModel.mock.calls).toHaveLength(1);
      expect(invitation._id.toString()).toBe(INVITATION_ID);
    });

    it('still persists the invitation when the email send fails', async () => {
      mockMailService.sendInvitationEmail.mockRejectedValue(
        new Error('smtp down'),
      );

      const invitation = await service.inviteMember(ctx(HouseholdRole.OWNER), {
        email: 'unreachable@example.com',
      });

      expect(invitation._id.toString()).toBe(INVITATION_ID);
      expect(mockInvitationModel.mock.calls).toHaveLength(1);
    });

    it('creates a hashed, pending invitation and emails the raw token', async () => {
      const invitation = await service.inviteMember(ctx(HouseholdRole.OWNER), {
        email: 'New@Example.com',
      });

      // Supersedes prior pending invites for the same household+email.
      const revokeFilter = mockInvitationModel.updateMany.mock.calls[0][0];
      expect(revokeFilter.email).toBe('new@example.com');
      expect(revokeFilter.status).toBe(InvitationStatus.PENDING);

      const args = mockInvitationModel.mock.calls[0][0];
      expect(args.email).toBe('new@example.com');
      expect(args.role).toBe(HouseholdRole.ADULT); // default
      expect(args.status).toBe(InvitationStatus.PENDING);
      expect(args.tokenHash).toEqual(expect.any(String));
      expect(args.tokenHash).not.toContain('http'); // hash, not the raw url/token
      expect(args.expiresAt.getTime()).toBeGreaterThan(Date.now());

      // Email gets the raw token in a URL; the DB only ever holds the hash.
      expect(mockMailService.sendInvitationEmail).toHaveBeenCalledTimes(1);
      const [toEmail, inviteUrl] =
        mockMailService.sendInvitationEmail.mock.calls[0];
      expect(toEmail).toBe('new@example.com');
      expect(inviteUrl).toContain('token=');
      expect(inviteUrl).not.toContain(args.tokenHash);

      expect(invitation._id.toString()).toBe(INVITATION_ID);
    });

    it('respects an explicit role', async () => {
      await service.inviteMember(ctx(HouseholdRole.OWNER), {
        email: 'teen@example.com',
        role: HouseholdRole.TEEN,
      });

      expect(mockInvitationModel.mock.calls[0][0].role).toBe(
        HouseholdRole.TEEN,
      );
    });
  });

  describe('acceptInvitation', () => {
    function pendingInvitation(overrides: Record<string, any> = {}) {
      return {
        _id: new Types.ObjectId(INVITATION_ID),
        householdId: new Types.ObjectId(HOUSEHOLD_ID),
        email: 'invitee@example.com',
        role: HouseholdRole.ADULT,
        status: InvitationStatus.PENDING,
        save: jest.fn().mockResolvedValue(undefined),
        ...overrides,
      };
    }

    it('rejects an invalid or expired token', async () => {
      mockInvitationModel.findOne.mockReturnValue(createChainable(null));

      await expect(
        service.acceptInvitation(OTHER_USER_ID, 'bad-token'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('only matches pending, unexpired invitations', async () => {
      mockInvitationModel.findOne.mockReturnValue(createChainable(null));

      await service
        .acceptInvitation(OTHER_USER_ID, 'tok')
        .catch(() => undefined);

      const filter = mockInvitationModel.findOne.mock.calls[0][0];
      expect(filter.status).toBe(InvitationStatus.PENDING);
      expect(filter.expiresAt.$gt).toBeInstanceOf(Date);
    });

    it('forbids accepting when the user email does not match the invite', async () => {
      mockInvitationModel.findOne.mockReturnValue(
        createChainable(pendingInvitation()),
      );
      mockUserModel.findById.mockReturnValue(
        createChainable({
          _id: OTHER_USER_ID,
          email: 'someone-else@example.com',
        }),
      );

      await expect(
        service.acceptInvitation(OTHER_USER_ID, 'tok'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('forbids accepting when the user has no email', async () => {
      mockInvitationModel.findOne.mockReturnValue(
        createChainable(pendingInvitation()),
      );
      mockUserModel.findById.mockReturnValue(
        createChainable({ _id: OTHER_USER_ID }),
      );

      await expect(
        service.acceptInvitation(OTHER_USER_ID, 'tok'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    function activeMembershipDoc(role: HouseholdRole) {
      return {
        _id: new Types.ObjectId(MEMBER_DOC_ID),
        householdId: new Types.ObjectId(OTHER_HOUSEHOLD_ID),
        role,
        save: jest.fn().mockImplementation(function (this: any) {
          return Promise.resolve(this);
        }),
      };
    }

    it('switches a solo owner’s active membership in place and marks accepted', async () => {
      const invitation = pendingInvitation();
      mockInvitationModel.findOne.mockReturnValue(createChainable(invitation));
      mockUserModel.findById.mockReturnValue(
        createChainable({
          _id: new Types.ObjectId(OTHER_USER_ID),
          email: 'invitee@example.com',
        }),
      );
      // No existing link to the invited household; user owns a solo personal
      // household (no other members), so the switch is allowed.
      const activeMembership = activeMembershipDoc(HouseholdRole.OWNER);
      mockMemberModel.findOne
        .mockReturnValueOnce(createChainable(null)) // existing-active lookup
        .mockReturnValueOnce(createChainable(activeMembership)); // active membership
      mockMemberModel.countDocuments.mockReturnValue(createChainable(0));

      const result = await service.acceptInvitation(OTHER_USER_ID, 'tok');

      expect(activeMembership.householdId.toString()).toBe(HOUSEHOLD_ID);
      expect(activeMembership.role).toBe(HouseholdRole.ADULT);
      expect(activeMembership.save).toHaveBeenCalledTimes(1);
      expect(invitation.status).toBe(InvitationStatus.ACCEPTED);
      expect(invitation.save).toHaveBeenCalledTimes(1);
      expect(result).toBe(activeMembership);
    });

    it('blocks an owner of a multi-member household from accepting', async () => {
      const invitation = pendingInvitation();
      mockInvitationModel.findOne.mockReturnValue(createChainable(invitation));
      mockUserModel.findById.mockReturnValue(
        createChainable({
          _id: new Types.ObjectId(OTHER_USER_ID),
          email: 'invitee@example.com',
        }),
      );
      const activeMembership = activeMembershipDoc(HouseholdRole.OWNER);
      mockMemberModel.findOne
        .mockReturnValueOnce(createChainable(null))
        .mockReturnValueOnce(createChainable(activeMembership));
      mockMemberModel.countDocuments.mockReturnValue(createChainable(1)); // other members

      await expect(
        service.acceptInvitation(OTHER_USER_ID, 'tok'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(activeMembership.save).not.toHaveBeenCalled();
      expect(invitation.status).toBe(InvitationStatus.PENDING);
    });

    it('translates a duplicate-key error on switch into a ConflictException', async () => {
      const invitation = pendingInvitation();
      mockInvitationModel.findOne.mockReturnValue(createChainable(invitation));
      mockUserModel.findById.mockReturnValue(
        createChainable({
          _id: new Types.ObjectId(OTHER_USER_ID),
          email: 'invitee@example.com',
        }),
      );
      const activeMembership = activeMembershipDoc(HouseholdRole.ADULT);
      activeMembership.save.mockRejectedValueOnce(duplicateKeyError());
      mockMemberModel.findOne
        .mockReturnValueOnce(createChainable(null))
        .mockReturnValueOnce(createChainable(activeMembership));

      await expect(
        service.acceptInvitation(OTHER_USER_ID, 'tok'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('creates a new active membership when the user has none', async () => {
      const invitation = pendingInvitation();
      mockInvitationModel.findOne.mockReturnValue(createChainable(invitation));
      mockUserModel.findById.mockReturnValue(
        createChainable({
          _id: new Types.ObjectId(OTHER_USER_ID),
          email: 'invitee@example.com',
        }),
      );
      // No existing-active row and no active membership at all.
      mockMemberModel.findOne
        .mockReturnValueOnce(createChainable(null))
        .mockReturnValueOnce(createChainable(null));

      await service.acceptInvitation(OTHER_USER_ID, 'tok');

      const memberArgs = mockMemberModel.mock.calls[0][0];
      expect(memberArgs.householdId.toString()).toBe(HOUSEHOLD_ID);
      expect(memberArgs.status).toBe(MembershipStatus.ACTIVE);
      expect(invitation.status).toBe(InvitationStatus.ACCEPTED);
    });

    it('is idempotent when the user is already linked to the invited household', async () => {
      const invitation = pendingInvitation();
      mockInvitationModel.findOne.mockReturnValue(createChainable(invitation));
      mockUserModel.findById.mockReturnValue(
        createChainable({
          _id: new Types.ObjectId(OTHER_USER_ID),
          email: 'invitee@example.com',
        }),
      );
      const existingLink = { _id: 'link', role: HouseholdRole.ADULT };
      mockMemberModel.findOne.mockReturnValueOnce(
        createChainable(existingLink),
      );

      const result = await service.acceptInvitation(OTHER_USER_ID, 'tok');

      expect(result).toBe(existingLink);
      expect(invitation.status).toBe(InvitationStatus.ACCEPTED);
      // Only the existing-link lookup ran; no active-membership mutation.
      expect(mockMemberModel.findOne).toHaveBeenCalledTimes(1);
    });
  });

  describe('removeMember', () => {
    function member(overrides: Record<string, any> = {}) {
      return {
        _id: new Types.ObjectId(MEMBER_DOC_ID),
        householdId: new Types.ObjectId(HOUSEHOLD_ID),
        userId: new Types.ObjectId(OTHER_USER_ID),
        role: HouseholdRole.ADULT,
        ...overrides,
      };
    }

    it('forbids a non-owner from removing members', async () => {
      await expect(
        service.removeMember(ctx(HouseholdRole.ADULT), MEMBER_DOC_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws NotFoundException when the member does not exist', async () => {
      mockMemberModel.findById.mockReturnValue(createChainable(null));

      await expect(
        service.removeMember(ctx(HouseholdRole.OWNER), MEMBER_DOC_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException when the member belongs to another household', async () => {
      mockMemberModel.findById.mockReturnValue(
        createChainable(
          member({ householdId: new Types.ObjectId(OTHER_HOUSEHOLD_ID) }),
        ),
      );

      await expect(
        service.removeMember(ctx(HouseholdRole.OWNER), MEMBER_DOC_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(mockMemberModel.deleteOne).not.toHaveBeenCalled();
    });

    it('forbids removing the household owner', async () => {
      mockMemberModel.findById.mockReturnValue(
        createChainable(member({ role: HouseholdRole.OWNER })),
      );

      await expect(
        service.removeMember(ctx(HouseholdRole.OWNER), MEMBER_DOC_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(mockMemberModel.deleteOne).not.toHaveBeenCalled();
    });

    it('deletes the member and re-provisions them a personal household', async () => {
      mockMemberModel.findById.mockReturnValue(createChainable(member()));
      mockUserModel.findById.mockReturnValue(
        createChainable({
          _id: new Types.ObjectId(OTHER_USER_ID),
          username: 'removed',
          displayName: 'Removed User',
        }),
      );

      await service.removeMember(ctx(HouseholdRole.OWNER), MEMBER_DOC_ID);

      expect(mockMemberModel.deleteOne.mock.calls[0][0]._id.toString()).toBe(
        MEMBER_DOC_ID,
      );
      // Re-provisions a personal household for the removed user (createHousehold
      // → new household named after them).
      expect(mockHouseholdModel.mock.calls[0][0].name).toBe(
        "Removed User's Household",
      );
      expect(mockHouseholdModel.mock.calls[0][0].ownerId.toString()).toBe(
        OTHER_USER_ID,
      );
    });

    it('does not fail the removal if re-provisioning throws', async () => {
      mockMemberModel.findById.mockReturnValue(createChainable(member()));
      householdSave.mockRejectedValueOnce(new Error('db down'));

      await expect(
        service.removeMember(ctx(HouseholdRole.OWNER), MEMBER_DOC_ID),
      ).resolves.toBeUndefined();
      expect(mockMemberModel.deleteOne).toHaveBeenCalledTimes(1);
    });
  });
});
