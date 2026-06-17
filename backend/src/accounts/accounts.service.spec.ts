import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, Logger } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { AccountsService } from './accounts.service';
import { Account, AccountType } from './schemas/account.schema';

const HOUSEHOLD_ID = '507f191e810c19729de860ea';
const OTHER_HOUSEHOLD_ID = '507f191e810c19729de860eb';
const ACCOUNT_ID = '507f191e810c19729de860ec';

function createChainable(resolvedValue: any = null) {
  const chain: any = {};
  chain.sort = jest.fn().mockReturnValue(chain);
  chain.exec = jest.fn().mockResolvedValue(resolvedValue);
  return chain;
}

describe('AccountsService', () => {
  let service: AccountsService;
  let mockAccountModel: any;
  let accountSave: jest.Mock;

  beforeEach(async () => {
    accountSave = jest.fn().mockImplementation(function (this: any) {
      return Promise.resolve({ _id: new Types.ObjectId(ACCOUNT_ID), ...this });
    });

    mockAccountModel = jest
      .fn()
      .mockImplementation((dto) => ({ ...dto, save: accountSave }));
    mockAccountModel.find = jest.fn().mockReturnValue(createChainable([]));
    mockAccountModel.findById = jest
      .fn()
      .mockReturnValue(createChainable(null));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountsService,
        { provide: getModelToken(Account.name), useValue: mockAccountModel },
      ],
    }).compile();

    module.useLogger(false);
    service = module.get<AccountsService>(AccountsService);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => jest.clearAllMocks());

  describe('create', () => {
    it('creates an account scoped to the household with the given fields', async () => {
      await service.create(HOUSEHOLD_ID, {
        name: 'Everyday Checking',
        type: AccountType.CHECKING,
        balanceCents: 125000,
      });

      const args = mockAccountModel.mock.calls[0][0];
      expect(args.householdId.toString()).toBe(HOUSEHOLD_ID);
      expect(args.name).toBe('Everyday Checking');
      expect(args.type).toBe(AccountType.CHECKING);
      expect(args.balanceCents).toBe(125000);
      expect(accountSave).toHaveBeenCalledTimes(1);
    });

    it('defaults the opening balance to 0 cents when omitted', async () => {
      await service.create(HOUSEHOLD_ID, {
        name: 'Wallet',
        type: AccountType.CASH,
      });

      expect(mockAccountModel.mock.calls[0][0].balanceCents).toBe(0);
    });

    it('stores a negative opening balance for credit/loan accounts', async () => {
      await service.create(HOUSEHOLD_ID, {
        name: 'Visa',
        type: AccountType.CREDIT,
        balanceCents: -45000,
      });

      expect(mockAccountModel.mock.calls[0][0].balanceCents).toBe(-45000);
    });
  });

  describe('findAll', () => {
    it('lists only non-archived accounts by default', async () => {
      await service.findAll(HOUSEHOLD_ID);

      const filter = mockAccountModel.find.mock.calls[0][0];
      expect(filter.householdId.toString()).toBe(HOUSEHOLD_ID);
      expect(filter.isArchived).toBe(false);
    });

    it('includes archived accounts when requested', async () => {
      await service.findAll(HOUSEHOLD_ID, true);

      const filter = mockAccountModel.find.mock.calls[0][0];
      expect(filter.householdId.toString()).toBe(HOUSEHOLD_ID);
      expect(filter.isArchived).toBeUndefined();
    });
  });

  describe('findOne', () => {
    it('returns the account when it belongs to the household', async () => {
      const doc = {
        _id: new Types.ObjectId(ACCOUNT_ID),
        householdId: new Types.ObjectId(HOUSEHOLD_ID),
      };
      mockAccountModel.findById.mockReturnValue(createChainable(doc));

      const result = await service.findOne(HOUSEHOLD_ID, ACCOUNT_ID);
      expect(result).toBe(doc);
    });

    it('throws NotFound for a malformed id without querying', async () => {
      await expect(service.findOne(HOUSEHOLD_ID, 'not-an-id')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockAccountModel.findById).not.toHaveBeenCalled();
    });

    it('throws NotFound when the account does not exist', async () => {
      mockAccountModel.findById.mockReturnValue(createChainable(null));

      await expect(service.findOne(HOUSEHOLD_ID, ACCOUNT_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFound when the account belongs to another household', async () => {
      mockAccountModel.findById.mockReturnValue(
        createChainable({
          _id: new Types.ObjectId(ACCOUNT_ID),
          householdId: new Types.ObjectId(OTHER_HOUSEHOLD_ID),
        }),
      );

      await expect(service.findOne(HOUSEHOLD_ID, ACCOUNT_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('applies the patch and saves the household-scoped account', async () => {
      const save = jest.fn().mockResolvedValue({ name: 'Renamed' });
      mockAccountModel.findById.mockReturnValue(
        createChainable({
          _id: new Types.ObjectId(ACCOUNT_ID),
          householdId: new Types.ObjectId(HOUSEHOLD_ID),
          name: 'Old',
          save,
        }),
      );

      await service.update(HOUSEHOLD_ID, ACCOUNT_ID, { name: 'Renamed' });
      expect(save).toHaveBeenCalledTimes(1);
    });

    it('does not overwrite fields whose patch value is undefined', async () => {
      const doc: any = {
        _id: new Types.ObjectId(ACCOUNT_ID),
        householdId: new Types.ObjectId(HOUSEHOLD_ID),
        name: 'Old',
        isArchived: false,
        balanceCents: 5000,
        save: jest.fn().mockImplementation(function (this: any) {
          return Promise.resolve(this);
        }),
      };
      mockAccountModel.findById.mockReturnValue(createChainable(doc));

      // Mirrors a PartialType DTO instance with unset optional fields present
      // as undefined own-properties.
      await service.update(HOUSEHOLD_ID, ACCOUNT_ID, {
        name: 'New',
        isArchived: undefined,
        balanceCents: undefined,
      } as any);

      expect(doc.name).toBe('New');
      expect(doc.isArchived).toBe(false);
      expect(doc.balanceCents).toBe(5000);
    });

    it('throws NotFound (via findOne) for an account in another household', async () => {
      mockAccountModel.findById.mockReturnValue(
        createChainable({
          _id: new Types.ObjectId(ACCOUNT_ID),
          householdId: new Types.ObjectId(OTHER_HOUSEHOLD_ID),
          save: jest.fn(),
        }),
      );

      await expect(
        service.update(HOUSEHOLD_ID, ACCOUNT_ID, { name: 'Renamed' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('applyBalanceDelta', () => {
    beforeEach(() => {
      mockAccountModel.updateOne = jest
        .fn()
        .mockReturnValue(createChainable({ modifiedCount: 1 }));
    });

    it('atomically $inc the household-scoped account by the delta', async () => {
      await service.applyBalanceDelta(HOUSEHOLD_ID, ACCOUNT_ID, -4200);

      const [filter, update] = mockAccountModel.updateOne.mock.calls[0];
      expect(filter._id.toString()).toBe(ACCOUNT_ID);
      expect(filter.householdId.toString()).toBe(HOUSEHOLD_ID);
      expect(update).toEqual({ $inc: { balanceCents: -4200 } });
    });

    it('skips the write for a zero delta', async () => {
      await service.applyBalanceDelta(HOUSEHOLD_ID, ACCOUNT_ID, 0);
      expect(mockAccountModel.updateOne).not.toHaveBeenCalled();
    });

    it('logs an error when no account matched (drift)', async () => {
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      mockAccountModel.updateOne.mockReturnValue(
        createChainable({ matchedCount: 0 }),
      );

      await service.applyBalanceDelta(HOUSEHOLD_ID, ACCOUNT_ID, -4200);

      expect(errorSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('archive', () => {
    it('sets isArchived and saves', async () => {
      const doc: any = {
        _id: new Types.ObjectId(ACCOUNT_ID),
        householdId: new Types.ObjectId(HOUSEHOLD_ID),
        isArchived: false,
        save: jest.fn().mockImplementation(function (this: any) {
          return Promise.resolve(this);
        }),
      };
      mockAccountModel.findById.mockReturnValue(createChainable(doc));

      const result = await service.archive(HOUSEHOLD_ID, ACCOUNT_ID);
      expect(doc.isArchived).toBe(true);
      expect(doc.save).toHaveBeenCalledTimes(1);
      expect(result.isArchived).toBe(true);
    });

    it('throws NotFound (via findOne) for an account in another household', async () => {
      mockAccountModel.findById.mockReturnValue(
        createChainable({
          _id: new Types.ObjectId(ACCOUNT_ID),
          householdId: new Types.ObjectId(OTHER_HOUSEHOLD_ID),
          save: jest.fn(),
        }),
      );

      await expect(service.archive(HOUSEHOLD_ID, ACCOUNT_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
