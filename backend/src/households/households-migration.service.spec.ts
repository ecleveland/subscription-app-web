import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, Logger } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { HouseholdsMigrationService } from './households-migration.service';
import { HouseholdsService } from './households.service';
import { User } from '../users/schemas/user.schema';
import { HouseholdMember } from './schemas/household-member.schema';

const USER_A = '507f1f77bcf86cd799439011';
const USER_B = '507f1f77bcf86cd799439012';
const USER_C = '507f1f77bcf86cd799439013';

function user(id: string, fields: { displayName?: string; username: string }) {
  return { _id: new Types.ObjectId(id), ...fields };
}

describe('HouseholdsMigrationService', () => {
  let service: HouseholdsMigrationService;
  let mockUserModel: any;
  let mockMemberModel: any;
  let mockHouseholdsService: { createHousehold: jest.Mock };

  function setUsers(users: unknown[]) {
    mockUserModel.find.mockReturnValue({
      select: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(users),
      }),
    });
  }

  function setActiveUserIds(ids: string[]) {
    mockMemberModel.distinct.mockResolvedValue(
      ids.map((id) => new Types.ObjectId(id)),
    );
  }

  beforeEach(async () => {
    mockUserModel = { find: jest.fn() };
    mockMemberModel = { distinct: jest.fn() };
    mockHouseholdsService = {
      createHousehold: jest.fn().mockResolvedValue({ _id: 'h' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HouseholdsMigrationService,
        { provide: getModelToken(User.name), useValue: mockUserModel },
        {
          provide: getModelToken(HouseholdMember.name),
          useValue: mockMemberModel,
        },
        { provide: HouseholdsService, useValue: mockHouseholdsService },
      ],
    }).compile();

    module.useLogger(false);
    service = module.get(HouseholdsMigrationService);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => jest.clearAllMocks());

  it('creates a personal household for every user when none have memberships', async () => {
    setActiveUserIds([]);
    setUsers([
      user(USER_A, { displayName: 'Alice', username: 'alice' }),
      user(USER_B, { displayName: 'Bob', username: 'bob' }),
    ]);

    const created = await service.backfillPersonalHouseholds();

    expect(created).toBe(2);
    expect(mockHouseholdsService.createHousehold).toHaveBeenCalledWith(USER_A, {
      name: "Alice's Household",
    });
    expect(mockHouseholdsService.createHousehold).toHaveBeenCalledWith(USER_B, {
      name: "Bob's Household",
    });
  });

  it('skips users who already have an active membership', async () => {
    setActiveUserIds([USER_A]);
    setUsers([
      user(USER_A, { displayName: 'Alice', username: 'alice' }),
      user(USER_B, { displayName: 'Bob', username: 'bob' }),
    ]);

    const created = await service.backfillPersonalHouseholds();

    expect(created).toBe(1);
    expect(mockHouseholdsService.createHousehold).toHaveBeenCalledTimes(1);
    expect(mockHouseholdsService.createHousehold).toHaveBeenCalledWith(USER_B, {
      name: "Bob's Household",
    });
    expect(mockHouseholdsService.createHousehold).not.toHaveBeenCalledWith(
      USER_A,
      expect.anything(),
    );
  });

  it('is idempotent — a re-run with everyone migrated creates nothing', async () => {
    setActiveUserIds([USER_A, USER_B]);
    setUsers([
      user(USER_A, { displayName: 'Alice', username: 'alice' }),
      user(USER_B, { displayName: 'Bob', username: 'bob' }),
    ]);

    const created = await service.backfillPersonalHouseholds();

    expect(created).toBe(0);
    expect(mockHouseholdsService.createHousehold).not.toHaveBeenCalled();
  });

  it('falls back to username when displayName is missing or blank', async () => {
    setActiveUserIds([]);
    setUsers([
      user(USER_A, { username: 'alice' }),
      user(USER_B, { displayName: '   ', username: 'bob' }),
    ]);

    await service.backfillPersonalHouseholds();

    expect(mockHouseholdsService.createHousehold).toHaveBeenCalledWith(USER_A, {
      name: "alice's Household",
    });
    expect(mockHouseholdsService.createHousehold).toHaveBeenCalledWith(USER_B, {
      name: "bob's Household",
    });
  });

  it('swallows a ConflictException (concurrent replica) and keeps going', async () => {
    setActiveUserIds([]);
    setUsers([
      user(USER_A, { username: 'alice' }),
      user(USER_B, { username: 'bob' }),
      user(USER_C, { username: 'carol' }),
    ]);
    mockHouseholdsService.createHousehold
      .mockResolvedValueOnce({ _id: 'h1' })
      .mockRejectedValueOnce(new ConflictException('already a member'))
      .mockResolvedValueOnce({ _id: 'h3' });

    const created = await service.backfillPersonalHouseholds();

    // A and C created; B lost the race and was skipped without aborting.
    expect(created).toBe(2);
    expect(mockHouseholdsService.createHousehold).toHaveBeenCalledTimes(3);
  });

  it('rethrows non-conflict errors', async () => {
    setActiveUserIds([]);
    setUsers([user(USER_A, { username: 'alice' })]);
    mockHouseholdsService.createHousehold.mockRejectedValueOnce(
      new Error('db down'),
    );

    await expect(service.backfillPersonalHouseholds()).rejects.toThrow(
      'db down',
    );
  });
});
