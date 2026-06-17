import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, Logger } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { HouseholdsService } from './households.service';
import { Household } from './schemas/household.schema';
import {
  HouseholdMember,
  HouseholdRole,
  MembershipStatus,
} from './schemas/household-member.schema';

const OWNER_ID = '507f1f77bcf86cd799439011';
const HOUSEHOLD_ID = '507f191e810c19729de860ea';
const OTHER_USER_ID = '507f1f77bcf86cd799439099';

function createChainable(resolvedValue: any = null) {
  const chain: any = {};
  chain.select = jest.fn().mockReturnValue(chain);
  chain.exec = jest.fn().mockResolvedValue(resolvedValue);
  return chain;
}

function duplicateKeyError(): Error {
  return Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
}

describe('HouseholdsService', () => {
  let service: HouseholdsService;
  let mockHouseholdModel: any;
  let mockMemberModel: any;
  let householdSave: jest.Mock;
  let memberSave: jest.Mock;

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

    mockHouseholdModel = jest
      .fn()
      .mockImplementation((dto) => ({ ...dto, save: householdSave }));
    mockHouseholdModel.deleteOne = jest
      .fn()
      .mockResolvedValue({ deletedCount: 1 });

    mockMemberModel = jest
      .fn()
      .mockImplementation((dto) => ({ ...dto, save: memberSave }));
    mockMemberModel.findOne = jest.fn().mockReturnValue(createChainable(null));
    mockMemberModel.deleteMany = jest
      .fn()
      .mockReturnValue(createChainable({ deletedCount: 0 }));

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
});
