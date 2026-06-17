import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { TransactionsService } from './transactions.service';
import { Transaction, TransactionType } from './schemas/transaction.schema';
import { AccountsService } from '../accounts/accounts.service';
import { CategoriesService } from '../categories/categories.service';

const HOUSEHOLD_ID = '507f191e810c19729de860ea';
const MEMBER_ID = '507f191e810c19729de860e1';
const ACC_A = '507f191e810c19729de860a1';
const ACC_B = '507f191e810c19729de860b2';
const ACC_C = '507f191e810c19729de860c3';
const CAT_ID = '507f191e810c19729de860d4';
const TXN_ID = '507f191e810c19729de860f5';
const OTHER_HOUSEHOLD_ID = '507f191e810c19729de860eb';

function createChainable(resolvedValue: any = null) {
  const chain: any = {};
  chain.sort = jest.fn().mockReturnValue(chain);
  chain.skip = jest.fn().mockReturnValue(chain);
  chain.limit = jest.fn().mockReturnValue(chain);
  chain.exec = jest.fn().mockResolvedValue(resolvedValue);
  return chain;
}

// A stored transaction doc shape for findById-based paths.
function txnDoc(overrides: Record<string, any> = {}) {
  return {
    _id: new Types.ObjectId(TXN_ID),
    householdId: new Types.ObjectId(HOUSEHOLD_ID),
    accountId: new Types.ObjectId(ACC_A),
    categoryId: new Types.ObjectId(CAT_ID),
    transferAccountId: undefined,
    memberId: new Types.ObjectId(MEMBER_ID),
    type: TransactionType.EXPENSE,
    amountCents: 4200,
    date: new Date('2026-06-01'),
    tags: [],
    cleared: false,
    save: jest.fn().mockImplementation(function (this: any) {
      return Promise.resolve(this);
    }),
    ...overrides,
  };
}

describe('TransactionsService', () => {
  let service: TransactionsService;
  let mockModel: any;
  let txnSave: jest.Mock;
  let accountsService: { findOne: jest.Mock; applyBalanceDelta: jest.Mock };
  let categoriesService: { findInHousehold: jest.Mock };

  beforeEach(async () => {
    txnSave = jest.fn().mockImplementation(function (this: any) {
      return Promise.resolve({ _id: new Types.ObjectId(TXN_ID), ...this });
    });
    mockModel = jest
      .fn()
      .mockImplementation((dto) => ({ ...dto, save: txnSave }));
    mockModel.find = jest.fn().mockReturnValue(createChainable([]));
    mockModel.findById = jest.fn().mockReturnValue(createChainable(null));
    mockModel.countDocuments = jest.fn().mockReturnValue(createChainable(0));
    mockModel.deleteOne = jest
      .fn()
      .mockReturnValue(createChainable({ deletedCount: 1 }));

    accountsService = {
      findOne: jest.fn().mockResolvedValue({ _id: new Types.ObjectId(ACC_A) }),
      applyBalanceDelta: jest.fn().mockResolvedValue(undefined),
    };
    categoriesService = {
      findInHousehold: jest
        .fn()
        .mockResolvedValue({ _id: new Types.ObjectId(CAT_ID) }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionsService,
        { provide: getModelToken(Transaction.name), useValue: mockModel },
        { provide: AccountsService, useValue: accountsService },
        { provide: CategoriesService, useValue: categoriesService },
      ],
    }).compile();

    module.useLogger(false);
    service = module.get<TransactionsService>(TransactionsService);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => jest.clearAllMocks());

  describe('create — balance effects', () => {
    const base = { accountId: ACC_A, date: '2026-06-17', amountCents: 4200 };

    it('expense decreases the account balance by the amount', async () => {
      await service.create(HOUSEHOLD_ID, MEMBER_ID, {
        ...base,
        type: TransactionType.EXPENSE,
        categoryId: CAT_ID,
      });

      expect(accountsService.applyBalanceDelta).toHaveBeenCalledTimes(1);
      expect(accountsService.applyBalanceDelta).toHaveBeenCalledWith(
        HOUSEHOLD_ID,
        ACC_A,
        -4200,
      );
    });

    it('income increases the account balance by the amount', async () => {
      await service.create(HOUSEHOLD_ID, MEMBER_ID, {
        ...base,
        amountCents: 5000,
        type: TransactionType.INCOME,
        categoryId: CAT_ID,
      });

      expect(accountsService.applyBalanceDelta).toHaveBeenCalledWith(
        HOUSEHOLD_ID,
        ACC_A,
        5000,
      );
    });

    it('transfer moves the amount from source to destination', async () => {
      await service.create(HOUSEHOLD_ID, MEMBER_ID, {
        accountId: ACC_A,
        date: '2026-06-17',
        amountCents: 10000,
        type: TransactionType.TRANSFER,
        transferAccountId: ACC_B,
      });

      expect(accountsService.applyBalanceDelta).toHaveBeenCalledWith(
        HOUSEHOLD_ID,
        ACC_A,
        -10000,
      );
      expect(accountsService.applyBalanceDelta).toHaveBeenCalledWith(
        HOUSEHOLD_ID,
        ACC_B,
        10000,
      );
    });

    it('stores the categoryId for income/expense and omits the transfer account', async () => {
      await service.create(HOUSEHOLD_ID, MEMBER_ID, {
        ...base,
        type: TransactionType.EXPENSE,
        categoryId: CAT_ID,
      });
      const built = mockModel.mock.calls[0][0];
      expect(built.categoryId).toBeDefined();
      expect(built.transferAccountId).toBeUndefined();
      expect(built.memberId.toString()).toBe(MEMBER_ID);
    });

    it('omits the category for a transfer', async () => {
      await service.create(HOUSEHOLD_ID, MEMBER_ID, {
        accountId: ACC_A,
        date: '2026-06-17',
        amountCents: 10000,
        type: TransactionType.TRANSFER,
        transferAccountId: ACC_B,
        // even if a stray categoryId is sent, normalize drops it
        categoryId: CAT_ID,
      });
      const built = mockModel.mock.calls[0][0];
      expect(built.categoryId).toBeUndefined();
      expect(built.transferAccountId).toBeDefined();
    });
  });

  describe('create — validation', () => {
    it('rejects income/expense without a category', async () => {
      await expect(
        service.create(HOUSEHOLD_ID, MEMBER_ID, {
          accountId: ACC_A,
          date: '2026-06-17',
          amountCents: 4200,
          type: TransactionType.EXPENSE,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(accountsService.applyBalanceDelta).not.toHaveBeenCalled();
    });

    it('rejects a transfer without a destination account', async () => {
      await expect(
        service.create(HOUSEHOLD_ID, MEMBER_ID, {
          accountId: ACC_A,
          date: '2026-06-17',
          amountCents: 10000,
          type: TransactionType.TRANSFER,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a transfer to the same account', async () => {
      await expect(
        service.create(HOUSEHOLD_ID, MEMBER_ID, {
          accountId: ACC_A,
          date: '2026-06-17',
          amountCents: 10000,
          type: TransactionType.TRANSFER,
          transferAccountId: ACC_A,
        }),
      ).rejects.toThrow(/two different accounts/);
    });

    it("rejects an account that isn't in the household (400, not 404)", async () => {
      accountsService.findOne.mockRejectedValueOnce(new NotFoundException());

      await expect(
        service.create(HOUSEHOLD_ID, MEMBER_ID, {
          accountId: ACC_A,
          date: '2026-06-17',
          amountCents: 4200,
          type: TransactionType.EXPENSE,
          categoryId: CAT_ID,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects a category that isn't in the household", async () => {
      categoriesService.findInHousehold.mockResolvedValueOnce(null);

      await expect(
        service.create(HOUSEHOLD_ID, MEMBER_ID, {
          accountId: ACC_A,
          date: '2026-06-17',
          amountCents: 4200,
          type: TransactionType.EXPENSE,
          categoryId: CAT_ID,
        }),
      ).rejects.toThrow(/category in this household/);
    });
  });

  describe('update — re-points balances', () => {
    it('adjusts the account by the delta when the amount changes', async () => {
      mockModel.findById.mockReturnValue(
        createChainable(txnDoc({ amountCents: 4200 })),
      );

      await service.update(HOUSEHOLD_ID, TXN_ID, { amountCents: 5000 });

      // reverse old expense (-4200 → +4200), then apply new expense (-5000)
      expect(accountsService.applyBalanceDelta).toHaveBeenNthCalledWith(
        1,
        HOUSEHOLD_ID,
        ACC_A,
        4200,
      );
      expect(accountsService.applyBalanceDelta).toHaveBeenNthCalledWith(
        2,
        HOUSEHOLD_ID,
        ACC_A,
        -5000,
      );
    });

    it('moves the effect to the new account when accountId changes', async () => {
      mockModel.findById.mockReturnValue(
        createChainable(txnDoc({ amountCents: 4200 })),
      );

      await service.update(HOUSEHOLD_ID, TXN_ID, { accountId: ACC_C });

      expect(accountsService.applyBalanceDelta).toHaveBeenCalledWith(
        HOUSEHOLD_ID,
        ACC_A,
        4200,
      );
      expect(accountsService.applyBalanceDelta).toHaveBeenCalledWith(
        HOUSEHOLD_ID,
        ACC_C,
        -4200,
      );
    });

    it('converts an expense to a transfer, dropping the category', async () => {
      mockModel.findById.mockReturnValue(
        createChainable(txnDoc({ amountCents: 4200 })),
      );

      const saved = await service.update(HOUSEHOLD_ID, TXN_ID, {
        type: TransactionType.TRANSFER,
        transferAccountId: ACC_B,
      });

      // old expense reversed on A (+4200); transfer applies A -4200, B +4200
      expect(accountsService.applyBalanceDelta).toHaveBeenCalledWith(
        HOUSEHOLD_ID,
        ACC_A,
        4200,
      );
      expect(accountsService.applyBalanceDelta).toHaveBeenCalledWith(
        HOUSEHOLD_ID,
        ACC_A,
        -4200,
      );
      expect(accountsService.applyBalanceDelta).toHaveBeenCalledWith(
        HOUSEHOLD_ID,
        ACC_B,
        4200,
      );
      expect(saved.categoryId).toBeUndefined();
    });
  });

  describe('remove — reverses the effect', () => {
    it('reverses an expense on delete', async () => {
      mockModel.findById.mockReturnValue(
        createChainable(txnDoc({ amountCents: 4200 })),
      );

      await service.remove(HOUSEHOLD_ID, TXN_ID);

      expect(mockModel.deleteOne).toHaveBeenCalledTimes(1);
      expect(accountsService.applyBalanceDelta).toHaveBeenCalledWith(
        HOUSEHOLD_ID,
        ACC_A,
        4200,
      );
    });

    it('reverses both legs of a transfer on delete', async () => {
      mockModel.findById.mockReturnValue(
        createChainable(
          txnDoc({
            type: TransactionType.TRANSFER,
            amountCents: 10000,
            categoryId: undefined,
            transferAccountId: new Types.ObjectId(ACC_B),
          }),
        ),
      );

      await service.remove(HOUSEHOLD_ID, TXN_ID);

      // reverse source (-10000 → +10000) and destination (+10000 → -10000)
      expect(accountsService.applyBalanceDelta).toHaveBeenCalledWith(
        HOUSEHOLD_ID,
        ACC_A,
        10000,
      );
      expect(accountsService.applyBalanceDelta).toHaveBeenCalledWith(
        HOUSEHOLD_ID,
        ACC_B,
        -10000,
      );
    });
  });

  describe('findOne — scoping', () => {
    it('returns the transaction when it belongs to the household', async () => {
      const doc = txnDoc();
      mockModel.findById.mockReturnValue(createChainable(doc));
      const result = await service.findOne(HOUSEHOLD_ID, TXN_ID);
      expect(result).toBe(doc);
    });

    it('throws NotFound for a malformed id without querying', async () => {
      await expect(service.findOne(HOUSEHOLD_ID, 'nope')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockModel.findById).not.toHaveBeenCalled();
    });

    it("throws NotFound for another household's transaction", async () => {
      mockModel.findById.mockReturnValue(
        createChainable(
          txnDoc({ householdId: new Types.ObjectId(OTHER_HOUSEHOLD_ID) }),
        ),
      );
      await expect(service.findOne(HOUSEHOLD_ID, TXN_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findAll — filters & pagination', () => {
    it('builds a household-scoped filter with the supplied criteria', async () => {
      mockModel.countDocuments.mockReturnValue(createChainable(1));
      mockModel.find.mockReturnValue(createChainable([txnDoc()]));

      const res = await service.findAll(HOUSEHOLD_ID, {
        accountId: ACC_A,
        type: TransactionType.EXPENSE,
        cleared: false,
        dateFrom: '2026-06-01',
        dateTo: '2026-06-30',
        page: 1,
        limit: 20,
      });

      const filter = mockModel.find.mock.calls[0][0];
      expect(filter.householdId.toString()).toBe(HOUSEHOLD_ID);
      expect(filter.accountId.toString()).toBe(ACC_A);
      expect(filter.type).toBe(TransactionType.EXPENSE);
      expect(filter.cleared).toBe(false);
      expect(filter.date.$gte).toBeInstanceOf(Date);
      expect(filter.date.$lte).toBeInstanceOf(Date);
      expect(res.meta.total).toBe(1);
    });
  });
});
