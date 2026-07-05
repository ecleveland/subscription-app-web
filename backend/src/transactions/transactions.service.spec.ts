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
  chain.select = jest.fn().mockReturnValue(chain);
  chain.lean = jest.fn().mockReturnValue(chain);
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
  let categoriesService: {
    findInHousehold: jest.Mock;
    resolveImportCategories: jest.Mock;
  };

  beforeEach(async () => {
    txnSave = jest.fn().mockImplementation(function (this: any) {
      return Promise.resolve({ _id: new Types.ObjectId(TXN_ID), ...this });
    });
    mockModel = jest
      .fn()
      .mockImplementation((dto) => ({ ...dto, save: txnSave }));
    mockModel.find = jest.fn().mockReturnValue(createChainable([]));
    mockModel.findById = jest.fn().mockReturnValue(createChainable(null));
    mockModel.findOne = jest.fn().mockReturnValue(createChainable(null));
    mockModel.countDocuments = jest.fn().mockReturnValue(createChainable(0));
    mockModel.deleteOne = jest
      .fn()
      .mockReturnValue(createChainable({ deletedCount: 1 }));
    // Echo the inserted docs back so importTransactions derives its imported
    // count and balance delta from what "persisted".
    mockModel.insertMany = jest
      .fn()
      .mockImplementation((docs) => Promise.resolve(docs));
    mockModel.aggregate = jest.fn().mockReturnValue(createChainable([]));

    accountsService = {
      findOne: jest.fn().mockResolvedValue({ _id: new Types.ObjectId(ACC_A) }),
      applyBalanceDelta: jest.fn().mockResolvedValue(undefined),
    };
    categoriesService = {
      findInHousehold: jest
        .fn()
        .mockResolvedValue({ _id: new Types.ObjectId(CAT_ID) }),
      resolveImportCategories: jest.fn().mockResolvedValue({
        byName: new Map([['groceries', new Types.ObjectId(CAT_ID)]]),
        fallbackId: new Types.ObjectId(CAT_ID),
      }),
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

    it('rejects creating a transaction on an archived account', async () => {
      accountsService.findOne.mockResolvedValueOnce({
        _id: new Types.ObjectId(ACC_A),
        isArchived: true,
      });

      await expect(
        service.create(HOUSEHOLD_ID, MEMBER_ID, {
          accountId: ACC_A,
          date: '2026-06-17',
          amountCents: 4200,
          type: TransactionType.EXPENSE,
          categoryId: CAT_ID,
        }),
      ).rejects.toThrow(/archived account/);
      expect(accountsService.applyBalanceDelta).not.toHaveBeenCalled();
    });

    it('rejects creating a transaction against an archived category', async () => {
      categoriesService.findInHousehold.mockResolvedValueOnce({
        _id: new Types.ObjectId(CAT_ID),
        isArchived: true,
      });

      await expect(
        service.create(HOUSEHOLD_ID, MEMBER_ID, {
          accountId: ACC_A,
          date: '2026-06-17',
          amountCents: 4200,
          type: TransactionType.EXPENSE,
          categoryId: CAT_ID,
        }),
      ).rejects.toThrow(/archived category/);
      expect(accountsService.applyBalanceDelta).not.toHaveBeenCalled();
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

    it('computes pagination metadata for a multi-page result', async () => {
      mockModel.countDocuments.mockReturnValue(createChainable(5));
      const chain = createChainable([]);
      mockModel.find.mockReturnValue(chain);

      const res = await service.findAll(HOUSEHOLD_ID, { page: 1, limit: 2 });

      expect(res.meta).toMatchObject({
        total: 5,
        totalPages: 3,
        hasNextPage: true,
      });
      expect(chain.skip).toHaveBeenCalledWith(0);
      expect(chain.limit).toHaveBeenCalledWith(2);
    });

    it('returns everything without skip/limit when limit is 0', async () => {
      mockModel.countDocuments.mockReturnValue(createChainable(5));
      const chain = createChainable([]);
      mockModel.find.mockReturnValue(chain);

      const res = await service.findAll(HOUSEHOLD_ID, { limit: 0 });

      expect(res.meta.hasNextPage).toBe(false);
      expect(chain.skip).not.toHaveBeenCalled();
      expect(chain.limit).not.toHaveBeenCalled();
    });
  });

  describe('importTransactions', () => {
    const mapping = {
      date: 'Date',
      amount: 'Amount',
      payee: 'Payee',
      category: 'Category',
    };
    const importDto = (rows: Record<string, string>[]) => ({
      accountId: ACC_A,
      mapping,
      rows,
    });

    it('imports rows, deriving type from amount sign, and adjusts the balance once', async () => {
      const result = await service.importTransactions(
        HOUSEHOLD_ID,
        MEMBER_ID,
        importDto([
          {
            Date: '2026-06-01',
            Amount: '-42.00',
            Payee: 'Store',
            Category: 'Groceries',
          },
          {
            Date: '2026-06-02',
            Amount: '1,000.00',
            Payee: 'Job',
            Category: '',
          },
        ]),
      );

      expect(result.imported).toBe(2);
      expect(result.skipped).toBe(0);
      expect(result.errors).toEqual([]);

      const inserted = mockModel.insertMany.mock.calls[0][0];
      expect(inserted[0]).toMatchObject({
        type: TransactionType.EXPENSE,
        amountCents: 4200,
      });
      expect(inserted[1]).toMatchObject({
        type: TransactionType.INCOME,
        amountCents: 100000,
      });
      // net delta: -4200 (expense) + 100000 (income) = 95800, applied once
      expect(accountsService.applyBalanceDelta).toHaveBeenCalledTimes(1);
      expect(accountsService.applyBalanceDelta).toHaveBeenCalledWith(
        HOUSEHOLD_ID,
        ACC_A,
        95800,
      );
    });

    it('maps a category by name and falls back to the default otherwise', async () => {
      const groceriesId = new Types.ObjectId();
      const fallbackId = new Types.ObjectId();
      categoriesService.resolveImportCategories.mockResolvedValueOnce({
        byName: new Map([['groceries', groceriesId]]),
        fallbackId,
      });

      await service.importTransactions(
        HOUSEHOLD_ID,
        MEMBER_ID,
        importDto([
          {
            Date: '2026-06-01',
            Amount: '-10',
            Payee: 'A',
            Category: 'Groceries',
          },
          { Date: '2026-06-02', Amount: '-20', Payee: 'B', Category: 'Nope' },
        ]),
      );

      const inserted = mockModel.insertMany.mock.calls[0][0];
      // matched row uses the by-name id; unmatched row uses the fallback id
      expect(inserted[0].categoryId).toBe(groceriesId);
      expect(inserted[1].categoryId).toBe(fallbackId);
    });

    it('reports distinct errors for unparseable/zero amount and bad date', async () => {
      const result = await service.importTransactions(
        HOUSEHOLD_ID,
        MEMBER_ID,
        importDto([
          { Date: '2026-06-01', Amount: 'abc', Payee: 'A', Category: '' },
          { Date: '2026-06-02', Amount: '0.00', Payee: 'B', Category: '' },
          { Date: 'not-a-date', Amount: '-10', Payee: 'C', Category: '' },
          { Date: '2026-06-03', Amount: '-30', Payee: 'D', Category: '' },
        ]),
      );

      expect(result.imported).toBe(1);
      expect(result.errors).toEqual([
        { row: 0, message: 'Unparseable amount' },
        { row: 1, message: 'Zero amount' },
        { row: 2, message: 'Unparseable date' },
      ]);
    });

    it('skips rows that duplicate an existing transaction', async () => {
      // The pre-fetch returns an existing transaction whose dedupe key matches
      // the imported row.
      mockModel.find.mockReturnValue(
        createChainable([
          {
            date: new Date('2026-06-01'),
            amountCents: 4200,
            type: TransactionType.EXPENSE,
            payee: 'Store',
          },
        ]),
      );

      const result = await service.importTransactions(
        HOUSEHOLD_ID,
        MEMBER_ID,
        importDto([
          { Date: '2026-06-01', Amount: '-42', Payee: 'Store', Category: '' },
        ]),
      );

      expect(result.imported).toBe(0);
      expect(result.skipped).toBe(1);
      expect(mockModel.insertMany).not.toHaveBeenCalled();
    });

    it('is a clean no-op when every row errors', async () => {
      const result = await service.importTransactions(
        HOUSEHOLD_ID,
        MEMBER_ID,
        importDto([{ Date: 'bad', Amount: 'bad', Payee: 'A', Category: '' }]),
      );

      expect(result.imported).toBe(0);
      expect(mockModel.insertMany).not.toHaveBeenCalled();
      // balance still "applied" once with a zero delta (no-op inside the service)
      expect(accountsService.applyBalanceDelta).toHaveBeenCalledWith(
        HOUSEHOLD_ID,
        ACC_A,
        0,
      );
    });

    it('skips a duplicate within the same batch', async () => {
      const result = await service.importTransactions(
        HOUSEHOLD_ID,
        MEMBER_ID,
        importDto([
          { Date: '2026-06-01', Amount: '-42', Payee: 'Store', Category: '' },
          { Date: '2026-06-01', Amount: '-42', Payee: 'Store', Category: '' },
        ]),
      );

      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(1);
    });

    it('rejects importing into an archived account', async () => {
      accountsService.findOne.mockResolvedValueOnce({
        _id: new Types.ObjectId(ACC_A),
        isArchived: true,
      });

      await expect(
        service.importTransactions(
          HOUSEHOLD_ID,
          MEMBER_ID,
          importDto([
            { Date: '2026-06-01', Amount: '-42', Payee: 'A', Category: '' },
          ]),
        ),
      ).rejects.toThrow(/archived account/);
    });

    it("rejects importing into another household's account (400)", async () => {
      accountsService.findOne.mockRejectedValueOnce(new NotFoundException());

      await expect(
        service.importTransactions(
          HOUSEHOLD_ID,
          MEMBER_ID,
          importDto([
            { Date: '2026-06-01', Amount: '-42', Payee: 'A', Category: '' },
          ]),
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('update — allows archived accounts (corrections)', () => {
    it('does not block an update when the account is archived', async () => {
      mockModel.findById.mockReturnValue(createChainable(txnDoc()));
      accountsService.findOne.mockResolvedValue({
        _id: new Types.ObjectId(ACC_A),
        isArchived: true,
      });

      await expect(
        service.update(HOUSEHOLD_ID, TXN_ID, { amountCents: 5000 }),
      ).resolves.toBeDefined();
    });

    it('does not block an update when the category is archived', async () => {
      mockModel.findById.mockReturnValue(createChainable(txnDoc()));
      categoriesService.findInHousehold.mockResolvedValue({
        _id: new Types.ObjectId(CAT_ID),
        isArchived: true,
      });

      await expect(
        service.update(HOUSEHOLD_ID, TXN_ID, { amountCents: 5000 }),
      ).resolves.toBeDefined();
    });
  });

  describe('aggregateMonthlyActualsByCategory', () => {
    const start = new Date('2026-06-01T00:00:00.000Z');
    const end = new Date('2026-07-01T00:00:00.000Z');
    const CAT_EXP = '507f191e810c19729de86011';
    const CAT_INC = '507f191e810c19729de86022';

    it('scopes the match to the household, the date range, and non-transfer types', async () => {
      await service.aggregateMonthlyActualsByCategory(HOUSEHOLD_ID, start, end);

      const pipeline = mockModel.aggregate.mock.calls[0][0];
      expect(pipeline[0].$match).toEqual({
        householdId: new Types.ObjectId(HOUSEHOLD_ID),
        type: { $in: [TransactionType.INCOME, TransactionType.EXPENSE] },
        date: { $gte: start, $lt: end },
      });
      // Grouped by (categoryId, type) so income vs expense stay distinct.
      expect(pipeline[1].$group._id).toEqual({
        categoryId: '$categoryId',
        type: '$type',
      });
    });

    it('returns one stringified row per (category, type) with summed cents', async () => {
      mockModel.aggregate.mockReturnValue(
        createChainable([
          {
            _id: {
              categoryId: new Types.ObjectId(CAT_EXP),
              type: TransactionType.EXPENSE,
            },
            totalCents: 8400,
          },
          {
            _id: {
              categoryId: new Types.ObjectId(CAT_INC),
              type: TransactionType.INCOME,
            },
            totalCents: 310000,
          },
        ]),
      );

      const result = await service.aggregateMonthlyActualsByCategory(
        HOUSEHOLD_ID,
        start,
        end,
      );

      expect(result).toEqual([
        {
          categoryId: CAT_EXP,
          type: TransactionType.EXPENSE,
          totalCents: 8400,
        },
        {
          categoryId: CAT_INC,
          type: TransactionType.INCOME,
          totalCents: 310000,
        },
      ]);
    });

    it('returns an empty array when no transactions match the month', async () => {
      mockModel.aggregate.mockReturnValue(createChainable([]));

      const result = await service.aggregateMonthlyActualsByCategory(
        HOUSEHOLD_ID,
        start,
        end,
      );

      expect(result).toEqual([]);
    });

    it('drops rows with a null categoryId rather than keying a Map on null', async () => {
      mockModel.aggregate.mockReturnValue(
        createChainable([
          {
            _id: { categoryId: null, type: TransactionType.EXPENSE },
            totalCents: 999,
          },
          {
            _id: {
              categoryId: new Types.ObjectId(CAT_EXP),
              type: TransactionType.EXPENSE,
            },
            totalCents: 100,
          },
        ]),
      );

      const result = await service.aggregateMonthlyActualsByCategory(
        HOUSEHOLD_ID,
        start,
        end,
      );

      expect(result).toEqual([
        { categoryId: CAT_EXP, type: TransactionType.EXPENSE, totalCents: 100 },
      ]);
    });
  });
});
