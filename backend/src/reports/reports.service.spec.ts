import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ReportsService } from './reports.service';
import {
  Transaction,
  TransactionType,
} from '../transactions/schemas/transaction.schema';
import { TransactionsService } from '../transactions/transactions.service';
import { BudgetsService } from '../budgets/budgets.service';
import { CategoriesService } from '../categories/categories.service';
import { AccountsService } from '../accounts/accounts.service';
import { AccountType } from '../accounts/schemas/account.schema';

type Row = {
  _id: { month: string; type: TransactionType };
  totalCents: number;
};

describe('ReportsService', () => {
  const householdId = new Types.ObjectId().toString();
  let service: ReportsService;
  let transactionModel: { aggregate: jest.Mock };
  let transactionsService: {
    aggregateMonthlyActualsByCategory: jest.Mock;
    sumLedgerDeltasByAccountAndMonth: jest.Mock;
  };
  let accountsService: { findAll: jest.Mock };
  let budgetsService: { getPlannedByCategory: jest.Mock };
  let categoriesService: {
    listCategories: jest.Mock;
    listGroups: jest.Mock;
  };

  function mockRows(rows: Row[]): void {
    transactionModel.aggregate.mockReturnValue({
      exec: jest.fn().mockResolvedValue(rows),
    });
  }

  // The pipeline the service handed to Mongo on its first call.
  function pipeline(): Record<string, any>[] {
    return transactionModel.aggregate.mock.calls[0][0];
  }

  beforeEach(async () => {
    transactionModel = { aggregate: jest.fn() };
    mockRows([]);
    transactionsService = {
      aggregateMonthlyActualsByCategory: jest.fn().mockResolvedValue([]),
      sumLedgerDeltasByAccountAndMonth: jest.fn().mockResolvedValue(new Map()),
    };
    accountsService = { findAll: jest.fn().mockResolvedValue([]) };
    budgetsService = {
      getPlannedByCategory: jest.fn().mockResolvedValue(new Map()),
    };
    categoriesService = {
      listCategories: jest.fn().mockResolvedValue([]),
      listGroups: jest.fn().mockResolvedValue([]),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        {
          provide: getModelToken(Transaction.name),
          useValue: transactionModel,
        },
        { provide: TransactionsService, useValue: transactionsService },
        { provide: BudgetsService, useValue: budgetsService },
        { provide: CategoriesService, useValue: categoriesService },
        { provide: AccountsService, useValue: accountsService },
      ],
    }).compile();
    service = module.get(ReportsService);
  });

  describe('getCashFlow', () => {
    it('matches only this household, income and expense, inside the UTC range', async () => {
      await service.getCashFlow(householdId, '2026-03', '2026-04');

      const match = pipeline()[0].$match;
      expect(match.householdId).toBeInstanceOf(Types.ObjectId);
      expect(match.householdId.toString()).toBe(householdId);
      // Transfers are excluded by the type filter.
      expect(match.type).toEqual({
        $in: [TransactionType.INCOME, TransactionType.EXPENSE],
      });
      // The first instant of from through the first instant after to,
      // exclusive. 2026-03-31T23:59:59Z is inside, 2026-05-01T00:00:00Z is not.
      expect(match.date).toEqual({
        $gte: new Date('2026-03-01T00:00:00.000Z'),
        $lt: new Date('2026-05-01T00:00:00.000Z'),
      });
    });

    it('does not filter by account, so a credit card expense counts as expense', async () => {
      await service.getCashFlow(householdId, '2026-03', '2026-03');
      const match = pipeline()[0].$match;
      expect(match).not.toHaveProperty('accountId');
      expect(match).not.toHaveProperty('transferAccountId');
    });

    it('groups by the UTC year-month of date and type', async () => {
      await service.getCashFlow(householdId, '2026-03', '2026-04');
      const group = pipeline()[1].$group;
      expect(group._id).toEqual({
        month: {
          $dateToString: { format: '%Y-%m', date: '$date', timezone: 'UTC' },
        },
        type: '$type',
      });
      expect(group.totalCents).toEqual({ $sum: '$amountCents' });
    });

    it('zero-fills an empty month inside the range', async () => {
      mockRows([
        {
          _id: { month: '2026-01', type: TransactionType.INCOME },
          totalCents: 500000,
        },
        {
          _id: { month: '2026-03', type: TransactionType.EXPENSE },
          totalCents: 12000,
        },
      ]);

      const result = await service.getCashFlow(
        householdId,
        '2026-01',
        '2026-03',
      );

      expect(result).toEqual({
        months: [
          {
            month: '2026-01',
            incomeCents: 500000,
            expenseCents: 0,
            netCents: 500000,
          },
          { month: '2026-02', incomeCents: 0, expenseCents: 0, netCents: 0 },
          {
            month: '2026-03',
            incomeCents: 0,
            expenseCents: 12000,
            netCents: -12000,
          },
        ],
      });
    });

    it('returns all-zero months when the household has no transactions', async () => {
      const result = await service.getCashFlow(
        householdId,
        '2026-11',
        '2027-01',
      );
      expect(result.months.map((m) => m.month)).toEqual([
        '2026-11',
        '2026-12',
        '2027-01',
      ]);
      expect(
        result.months.every(
          (m) =>
            m.incomeCents === 0 && m.expenseCents === 0 && m.netCents === 0,
        ),
      ).toBe(true);
    });

    it('computes netCents as income minus expense', async () => {
      mockRows([
        {
          _id: { month: '2026-03', type: TransactionType.INCOME },
          totalCents: 310000,
        },
        {
          _id: { month: '2026-03', type: TransactionType.EXPENSE },
          totalCents: 86000,
        },
        {
          _id: { month: '2026-04', type: TransactionType.INCOME },
          totalCents: 1000,
        },
        {
          _id: { month: '2026-04', type: TransactionType.EXPENSE },
          totalCents: 4500,
        },
      ]);

      const result = await service.getCashFlow(
        householdId,
        '2026-03',
        '2026-04',
      );

      expect(result.months).toEqual([
        {
          month: '2026-03',
          incomeCents: 310000,
          expenseCents: 86000,
          netCents: 224000,
        },
        {
          month: '2026-04',
          incomeCents: 1000,
          expenseCents: 4500,
          netCents: -3500,
        },
      ]);
    });

    it('puts the last second of a month and the first second of the next in separate months', async () => {
      // Mongo does the bucketing, so this pins the contract the service relies
      // on: rows keyed by month land on that month and nowhere else. The e2e
      // suite checks the real boundary against a database.
      mockRows([
        {
          _id: { month: '2026-03', type: TransactionType.EXPENSE },
          totalCents: 100,
        },
        {
          _id: { month: '2026-04', type: TransactionType.EXPENSE },
          totalCents: 200,
        },
      ]);
      const result = await service.getCashFlow(
        householdId,
        '2026-03',
        '2026-04',
      );
      expect(result.months.map((m) => m.expenseCents)).toEqual([100, 200]);
    });

    it('ignores a row outside the requested months instead of adding a month', async () => {
      mockRows([
        {
          _id: { month: '2025-12', type: TransactionType.INCOME },
          totalCents: 999,
        },
      ]);
      const result = await service.getCashFlow(
        householdId,
        '2026-01',
        '2026-01',
      );
      expect(result.months).toEqual([
        { month: '2026-01', incomeCents: 0, expenseCents: 0, netCents: 0 },
      ]);
    });

    it('warns with the household and the key when it drops a row outside the range', async () => {
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      mockRows([
        {
          _id: { month: '2025-12', type: TransactionType.INCOME },
          totalCents: 999,
        },
      ]);

      await service.getCashFlow(householdId, '2026-01', '2026-01');

      expect(warn).toHaveBeenCalledWith(
        { householdId, month: '2025-12' },
        expect.stringMatching(/outside the requested range/),
      );
      warn.mockRestore();
    });
  });

  describe('getSpending', () => {
    const GROUP_FOOD = new Types.ObjectId().toString();
    const GROUP_HOME = new Types.ObjectId().toString();
    const GROCERIES = new Types.ObjectId().toString();
    const DINING = new Types.ObjectId().toString();
    const RENT = new Types.ObjectId().toString();
    const SALARY = new Types.ObjectId().toString();
    const OLD = new Types.ObjectId().toString();

    function category(
      id: string,
      name: string,
      groupId: string,
      opts: { isIncome?: boolean; isArchived?: boolean } = {},
    ) {
      return {
        _id: new Types.ObjectId(id),
        groupId: new Types.ObjectId(groupId),
        name,
        isIncome: opts.isIncome ?? false,
        isArchived: opts.isArchived ?? false,
      };
    }

    function expense(categoryId: string | null, totalCents: number) {
      return { categoryId, type: TransactionType.EXPENSE, totalCents };
    }

    beforeEach(() => {
      categoriesService.listCategories.mockResolvedValue([
        category(GROCERIES, 'Groceries', GROUP_FOOD),
        category(DINING, 'Dining', GROUP_FOOD),
        category(RENT, 'Rent', GROUP_HOME),
        category(SALARY, 'Salary', GROUP_HOME, { isIncome: true }),
        category(OLD, 'Old Hobby', GROUP_HOME, { isArchived: true }),
      ]);
      categoriesService.listGroups.mockResolvedValue([
        { _id: new Types.ObjectId(GROUP_FOOD), name: 'Food' },
        { _id: new Types.ObjectId(GROUP_HOME), name: 'Home' },
      ]);
    });

    // A failed assertion skips a test's own mockRestore. Restore here too so
    // a warn spy never leaks into the next test.
    afterEach(() => jest.restoreAllMocks());

    function mockActuals(rows: ReturnType<typeof expense>[]): void {
      transactionsService.aggregateMonthlyActualsByCategory.mockResolvedValue(
        rows,
      );
    }

    function mockPlanned(entries: [string, number][]): void {
      budgetsService.getPlannedByCategory.mockResolvedValue(new Map(entries));
    }

    it('reads actuals for the UTC month, planned amounts for the month, and archived categories', async () => {
      await service.getSpending(householdId, '2026-03');

      expect(
        transactionsService.aggregateMonthlyActualsByCategory,
      ).toHaveBeenCalledWith(
        householdId,
        new Date('2026-03-01T00:00:00.000Z'),
        new Date('2026-04-01T00:00:00.000Z'),
      );
      expect(budgetsService.getPlannedByCategory).toHaveBeenCalledWith(
        householdId,
        '2026-03',
      );
      expect(categoriesService.listCategories).toHaveBeenCalledWith(
        householdId,
        true,
      );
      expect(categoriesService.listGroups).toHaveBeenCalledWith(householdId);
    });

    it('returns an empty report for a month with no spend and no plan', async () => {
      const result = await service.getSpending(householdId, '2026-03');
      expect(result).toEqual({
        month: '2026-03',
        categories: [],
        uncategorizedCents: 0,
        totalCents: 0,
      });
    });

    it('gives a category with spend but no planned row plannedCents null', async () => {
      mockActuals([expense(GROCERIES, 4200)]);

      const result = await service.getSpending(householdId, '2026-03');

      expect(result.categories).toEqual([
        {
          categoryId: GROCERIES,
          categoryName: 'Groceries',
          groupId: GROUP_FOOD,
          groupName: 'Food',
          actualCents: 4200,
          plannedCents: null,
        },
      ]);
    });

    it('includes a planned category with no spend at actualCents 0', async () => {
      mockPlanned([[RENT, 150000]]);

      const result = await service.getSpending(householdId, '2026-03');

      expect(result.categories).toEqual([
        {
          categoryId: RENT,
          categoryName: 'Rent',
          groupId: GROUP_HOME,
          groupName: 'Home',
          actualCents: 0,
          plannedCents: 150000,
        },
      ]);
      expect(result.totalCents).toBe(0);
    });

    it('keeps a planned 0 as 0, not null', async () => {
      mockActuals([expense(DINING, 900)]);
      mockPlanned([[DINING, 0]]);

      const result = await service.getSpending(householdId, '2026-03');

      expect(result.categories[0].plannedCents).toBe(0);
    });

    it('leaves out income categories even when they have actuals or a plan', async () => {
      mockActuals([
        {
          categoryId: SALARY,
          type: TransactionType.INCOME,
          totalCents: 500000,
        },
        expense(GROCERIES, 1000),
      ]);
      mockPlanned([[SALARY, 500000]]);

      const result = await service.getSpending(householdId, '2026-03');

      expect(result.categories.map((c) => c.categoryId)).toEqual([GROCERIES]);
      expect(result.totalCents).toBe(1000);
    });

    it('rolls spend on a category outside the household into uncategorizedCents and the total', async () => {
      const orphan = new Types.ObjectId().toString();
      mockActuals([expense(orphan, 700), expense(GROCERIES, 1000)]);

      const result = await service.getSpending(householdId, '2026-03');

      expect(result.categories.map((c) => c.categoryId)).toEqual([GROCERIES]);
      expect(result.uncategorizedCents).toBe(700);
      expect(result.totalCents).toBe(1700);
    });

    it('warns once with the ids when expense spend points at a category not in the household', async () => {
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const orphan = new Types.ObjectId().toString();
      mockActuals([expense(orphan, 700), expense(GROCERIES, 1000)]);

      await service.getSpending(householdId, '2026-03');

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        { householdId, month: '2026-03', categoryIds: [orphan] },
        'Spending report rolled spend on categories not in the household into uncategorizedCents',
      );
      warn.mockRestore();
    });

    it('rolls expense spend with no categoryId into uncategorizedCents and warns with a null id', async () => {
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      mockActuals([
        expense(null, 500),
        expense(GROCERIES, 1000),
        { categoryId: null, type: TransactionType.INCOME, totalCents: 4000 },
      ]);

      const result = await service.getSpending(householdId, '2026-03');

      expect(result.categories.map((c) => c.categoryId)).toEqual([GROCERIES]);
      expect(result.uncategorizedCents).toBe(500);
      expect(result.totalCents).toBe(1500);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        { householdId, month: '2026-03', categoryIds: ['null'] },
        'Spending report rolled spend on categories not in the household into uncategorizedCents',
      );
    });

    it('does not warn when expense spend sits on an income category', async () => {
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      mockActuals([expense(SALARY, 300), expense(GROCERIES, 1000)]);

      const result = await service.getSpending(householdId, '2026-03');

      expect(result.uncategorizedCents).toBe(300);
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    it('reconciles rows plus uncategorizedCents to totalCents, rolling orphan and income-category expense into uncategorized', async () => {
      const orphan = new Types.ObjectId().toString();
      mockActuals([
        expense(GROCERIES, 1000),
        expense(DINING, 500),
        expense(orphan, 700),
        expense(SALARY, 300),
        { categoryId: SALARY, type: TransactionType.INCOME, totalCents: 9999 },
      ]);

      const result = await service.getSpending(householdId, '2026-03');

      expect(result.categories.map((c) => c.categoryId)).toEqual([
        GROCERIES,
        DINING,
      ]);
      expect(result.uncategorizedCents).toBe(1000);
      expect(result.totalCents).toBe(2500);
      const rowSum = result.categories.reduce((n, c) => n + c.actualCents, 0);
      expect(rowSum + result.uncategorizedCents).toBe(result.totalCents);
    });

    it('warns once with the ids of planned rows whose category is not in the household', async () => {
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const unknownA = new Types.ObjectId().toString();
      const unknownB = new Types.ObjectId().toString();
      mockPlanned([
        [unknownA, 100],
        [unknownB, 200],
        [SALARY, 500000],
        [RENT, 150000],
      ]);

      const result = await service.getSpending(householdId, '2026-03');

      expect(result.categories.map((c) => c.categoryId)).toEqual([RENT]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        { householdId, month: '2026-03', categoryIds: [unknownA, unknownB] },
        expect.stringMatching(/planned/i),
      );
      warn.mockRestore();
    });

    it('does not warn for planned rows on household categories, income included', async () => {
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      mockPlanned([
        [RENT, 150000],
        [SALARY, 500000],
      ]);

      const result = await service.getSpending(householdId, '2026-03');

      expect(result.categories.map((c) => c.categoryId)).toEqual([RENT]);
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    it('warns once with the category ids when a group is missing, with a null group name', async () => {
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const LOST = new Types.ObjectId().toString();
      const lostGroup = new Types.ObjectId().toString();
      categoriesService.listCategories.mockResolvedValue([
        category(GROCERIES, 'Groceries', GROUP_FOOD),
        category(LOST, 'Lost', lostGroup),
      ]);
      mockActuals([expense(LOST, 400), expense(GROCERIES, 100)]);

      const result = await service.getSpending(householdId, '2026-03');

      expect(result.categories[0]).toMatchObject({
        categoryId: LOST,
        groupId: lostGroup,
        groupName: null,
      });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        { householdId, month: '2026-03', categoryIds: [LOST] },
        expect.stringMatching(/group/i),
      );
      warn.mockRestore();
    });

    it('sorts by actualCents descending, ties by categoryName ascending', async () => {
      // Listed so that unsorted output would be wrong twice over. The tied
      // pair comes in reverse alphabetical order and the top spender is last.
      categoriesService.listCategories.mockResolvedValue([
        category(RENT, 'Rent', GROUP_HOME),
        category(DINING, 'Dining', GROUP_FOOD),
        category(GROCERIES, 'Groceries', GROUP_FOOD),
      ]);
      mockActuals([
        expense(RENT, 500),
        expense(DINING, 500),
        expense(GROCERIES, 2000),
      ]);

      const result = await service.getSpending(householdId, '2026-03');

      expect(result.categories.map((c) => c.categoryName)).toEqual([
        'Groceries',
        'Dining',
        'Rent',
      ]);
    });

    it('shows an archived category with spend under its name and group', async () => {
      mockActuals([expense(OLD, 3300)]);

      const result = await service.getSpending(householdId, '2026-03');

      expect(result.categories).toEqual([
        {
          categoryId: OLD,
          categoryName: 'Old Hobby',
          groupId: GROUP_HOME,
          groupName: 'Home',
          actualCents: 3300,
          plannedCents: null,
        },
      ]);
    });
  });

  describe('getNetWorth', () => {
    const CHECKING = new Types.ObjectId().toString();
    const CREDIT = new Types.ObjectId().toString();
    const LOAN = new Types.ObjectId().toString();
    const SAVINGS = new Types.ObjectId().toString();
    const UNKNOWN = new Types.ObjectId().toString();

    // balanceCents is deliberately wrong. The report derives forward from
    // openingBalanceCents and never reads the cached balance.
    function account(
      id: string,
      name: string,
      type: AccountType,
      openingBalanceCents: number,
      isArchived = false,
      createdAt = new Date('2025-01-01T00:00:00.000Z'),
    ) {
      return {
        _id: new Types.ObjectId(id),
        name,
        type,
        openingBalanceCents,
        balanceCents: 123,
        isArchived,
        createdAt,
      };
    }

    // Signed monthly deltas as TransactionsService returns them. The March
    // checking -30000 and credit +30000 are the two legs of one transfer.
    function deltaFixture(): Map<string, Map<string, number>> {
      return new Map([
        [
          CHECKING,
          new Map([
            ['2026-01', 50000],
            ['2026-02', -10000],
            ['2026-03', -30000],
            ['2026-05', 2000],
            ['2026-06', -1000],
          ]),
        ],
        [
          CREDIT,
          new Map([
            ['2026-01', -5000],
            ['2026-02', -3000],
            ['2026-03', 30000],
            ['2026-05', -2500],
          ]),
        ],
        [
          LOAN,
          new Map([
            ['2026-01', 1000],
            ['2026-02', 1000],
            ['2026-03', 1000],
            ['2026-04', 1000],
            ['2026-05', 1000],
            ['2026-06', 1000],
          ]),
        ],
        [SAVINGS, new Map([['2026-02', 500]])],
        [UNKNOWN, new Map([['2026-03', 777]])],
      ]);
    }

    let warn: jest.SpyInstance;

    beforeEach(() => {
      warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      accountsService.findAll.mockResolvedValue([
        account(CHECKING, 'Checking', AccountType.CHECKING, 100000),
        account(CREDIT, 'Card', AccountType.CREDIT, -20000),
        account(LOAN, 'Mortgage', AccountType.LOAN, -500000),
        account(SAVINGS, 'Old savings', AccountType.SAVINGS, 25000, true),
      ]);
      transactionsService.sumLedgerDeltasByAccountAndMonth.mockResolvedValue(
        deltaFixture(),
      );
    });

    afterEach(() => warn.mockRestore());

    function balances(month: {
      accounts: { accountId: string; balanceCents: number }[];
    }): Record<string, number> {
      return Object.fromEntries(
        month.accounts.map((a) => [a.accountId, a.balanceCents]),
      );
    }

    it('nets a transfer to zero across the two accounts in its month', async () => {
      const { months } = await service.getNetWorth(
        householdId,
        '2026-01',
        '2026-06',
      );
      const feb = balances(months[1]);
      const mar = balances(months[2]);

      expect(mar[CHECKING] - feb[CHECKING]).toBe(-30000);
      expect(mar[CREDIT] - feb[CREDIT]).toBe(30000);
      expect(mar[CHECKING] + mar[CREDIT] - (feb[CHECKING] + feb[CREDIT])).toBe(
        0,
      );
    });

    it('loads archived accounts and deltas dated before the month after to', async () => {
      await service.getNetWorth(householdId, '2026-01', '2026-06');

      expect(accountsService.findAll).toHaveBeenCalledWith(householdId, true);
      expect(
        transactionsService.sumLedgerDeltasByAccountAndMonth,
      ).toHaveBeenCalledWith(householdId, new Date('2026-07-01T00:00:00.000Z'));
    });

    it('reports each account at its month-end balance with totals', async () => {
      const { months } = await service.getNetWorth(
        householdId,
        '2026-01',
        '2026-06',
      );

      expect(months.map((m) => m.month)).toEqual([
        '2026-01',
        '2026-02',
        '2026-03',
        '2026-04',
        '2026-05',
        '2026-06',
      ]);
      // February by hand. Checking 100000 + 50000 - 10000. Card -20000 - 5000
      // - 3000. Mortgage -500000 + 2000. Savings 25000 + 500.
      expect(months[1]).toEqual({
        month: '2026-02',
        assetsCents: 165500,
        liabilitiesCents: -526000,
        netWorthCents: -360500,
        accounts: [
          {
            accountId: CHECKING,
            name: 'Checking',
            type: AccountType.CHECKING,
            balanceCents: 140000,
          },
          {
            accountId: CREDIT,
            name: 'Card',
            type: AccountType.CREDIT,
            balanceCents: -28000,
          },
          {
            accountId: LOAN,
            name: 'Mortgage',
            type: AccountType.LOAN,
            balanceCents: -498000,
          },
          {
            accountId: SAVINGS,
            name: 'Old savings',
            type: AccountType.SAVINGS,
            balanceCents: 25500,
          },
        ],
      });
      for (const m of months) {
        expect(m.netWorthCents).toBe(m.assetsCents + m.liabilitiesCents);
      }
      expect(months.map((m) => [m.assetsCents, m.liabilitiesCents])).toEqual([
        [175000, -524000],
        [165500, -526000],
        [135500, -495000],
        [135500, -494000],
        [137500, -495500],
        [136500, -494500],
      ]);
    });

    it('ends each account at opening plus every delta', async () => {
      const { months } = await service.getNetWorth(
        householdId,
        '2026-01',
        '2026-06',
      );

      expect(balances(months[5])).toEqual({
        [CHECKING]: 100000 + 50000 - 10000 - 30000 + 2000 - 1000,
        [CREDIT]: -20000 - 5000 - 3000 + 30000 - 2500,
        [LOAN]: -500000 + 6000,
        [SAVINGS]: 25000 + 500,
      });
    });

    it('repeats the prior balance in a month with no deltas', async () => {
      const { months } = await service.getNetWorth(
        householdId,
        '2026-01',
        '2026-06',
      );
      const mar = balances(months[2]);
      const apr = balances(months[3]);

      expect(apr[CHECKING]).toBe(mar[CHECKING]);
      expect(apr[CREDIT]).toBe(mar[CREDIT]);
      expect(apr[SAVINGS]).toBe(mar[SAVINGS]);
    });

    it('reports opening balances for months before any deltas', async () => {
      const { months } = await service.getNetWorth(
        householdId,
        '2025-11',
        '2025-12',
      );

      expect(months.map((m) => m.month)).toEqual(['2025-11', '2025-12']);
      for (const m of months) {
        expect(balances(m)).toEqual({
          [CHECKING]: 100000,
          [CREDIT]: -20000,
          [LOAN]: -500000,
          [SAVINGS]: 25000,
        });
        expect(m.assetsCents).toBe(125000);
        expect(m.liabilitiesCents).toBe(-520000);
        expect(m.netWorthCents).toBe(-395000);
      }
    });

    it('carries deltas dated before from into the first month', async () => {
      const { months } = await service.getNetWorth(
        householdId,
        '2026-04',
        '2026-06',
      );

      expect(months.map((m) => m.month)).toEqual([
        '2026-04',
        '2026-05',
        '2026-06',
      ]);
      // January through March plus April's own delta.
      expect(balances(months[0])).toEqual({
        [CHECKING]: 110000,
        [CREDIT]: 2000,
        [LOAN]: -496000,
        [SAVINGS]: 25500,
      });
    });

    it('ignores deltas for accounts outside the household and warns once with the ids', async () => {
      const { months } = await service.getNetWorth(
        householdId,
        '2026-01',
        '2026-06',
      );

      for (const m of months) {
        expect(m.accounts.map((a) => a.accountId)).not.toContain(UNKNOWN);
      }
      expect(months[2].assetsCents).toBe(135500);
      const unknownWarnings = warn.mock.calls.filter(
        ([ctx]) => (ctx as { accountIds?: string[] }).accountIds !== undefined,
      );
      expect(unknownWarnings).toHaveLength(1);
      expect(unknownWarnings[0][0]).toEqual({
        householdId,
        accountIds: [UNKNOWN],
      });
    });

    it('does not warn when every delta belongs to a household account', async () => {
      const deltas = deltaFixture();
      deltas.delete(UNKNOWN);
      transactionsService.sumLedgerDeltasByAccountAndMonth.mockResolvedValue(
        deltas,
      );

      await service.getNetWorth(householdId, '2026-01', '2026-06');

      expect(warn).not.toHaveBeenCalled();
    });

    it('leaves an account out of the months before the month it was created', async () => {
      const LATE = new Types.ObjectId().toString();
      accountsService.findAll.mockResolvedValue([
        account(
          LATE,
          'Brokerage',
          AccountType.INVESTMENT,
          500000,
          false,
          new Date('2026-06-15T12:00:00.000Z'),
        ),
        account(CHECKING, 'Checking', AccountType.CHECKING, 100000),
      ]);
      transactionsService.sumLedgerDeltasByAccountAndMonth.mockResolvedValue(
        new Map(),
      );

      const { months } = await service.getNetWorth(
        householdId,
        '2026-01',
        '2026-07',
      );

      for (const m of months.slice(0, 5)) {
        expect(m.accounts.map((a) => a.accountId)).toEqual([CHECKING]);
        expect(m.assetsCents).toBe(100000);
        expect(m.netWorthCents).toBe(100000);
      }
      for (const m of months.slice(5)) {
        expect(balances(m)).toEqual({ [LATE]: 500000, [CHECKING]: 100000 });
        expect(m.assetsCents).toBe(600000);
      }
    });

    it('shows an account from its earliest delta month when that precedes creation', async () => {
      const LATE = new Types.ObjectId().toString();
      accountsService.findAll.mockResolvedValue([
        account(
          LATE,
          'Brokerage',
          AccountType.INVESTMENT,
          500000,
          false,
          new Date('2026-06-15T12:00:00.000Z'),
        ),
      ]);
      transactionsService.sumLedgerDeltasByAccountAndMonth.mockResolvedValue(
        new Map([[LATE, new Map([['2026-02', 700]])]]),
      );

      const { months } = await service.getNetWorth(
        householdId,
        '2026-01',
        '2026-07',
      );

      expect(months[0].accounts).toEqual([]);
      expect(months[0].assetsCents).toBe(0);
      for (const m of months.slice(1)) {
        expect(balances(m)).toEqual({ [LATE]: 500700 });
        expect(m.assetsCents).toBe(500700);
      }
    });

    it('shows both legs of a transfer backdated into a newer account', async () => {
      const SAVINGS_NEW = new Types.ObjectId().toString();
      accountsService.findAll.mockResolvedValue([
        account(
          SAVINGS_NEW,
          'New savings',
          AccountType.SAVINGS,
          0,
          false,
          new Date('2026-03-05T00:00:00.000Z'),
        ),
        account(
          CHECKING,
          'Checking',
          AccountType.CHECKING,
          100000,
          false,
          new Date('2026-01-10T00:00:00.000Z'),
        ),
      ]);
      transactionsService.sumLedgerDeltasByAccountAndMonth.mockResolvedValue(
        new Map([
          [CHECKING, new Map([['2026-01', -20000]])],
          [SAVINGS_NEW, new Map([['2026-01', 20000]])],
        ]),
      );

      const { months } = await service.getNetWorth(
        householdId,
        '2026-01',
        '2026-04',
      );

      for (const m of months) {
        expect(balances(m)).toEqual({
          [SAVINGS_NEW]: 20000,
          [CHECKING]: 80000,
        });
        expect(m.netWorthCents).toBe(100000);
      }
    });

    it('treats a missing or invalid createdAt as no creation limit and warns once with the ids', async () => {
      const NO_DATE_WITH_DELTA = new Types.ObjectId().toString();
      const NO_DATE_QUIET = new Types.ObjectId().toString();
      const BAD_DATE = new Types.ObjectId().toString();
      const STRING_DATE = new Types.ObjectId().toString();
      const withoutDate = account(
        NO_DATE_WITH_DELTA,
        'No date',
        AccountType.CASH,
        1000,
      ) as Record<string, unknown>;
      delete withoutDate.createdAt;
      const quiet = account(
        NO_DATE_QUIET,
        'Quiet',
        AccountType.CASH,
        2000,
      ) as Record<string, unknown>;
      delete quiet.createdAt;
      accountsService.findAll.mockResolvedValue([
        withoutDate,
        quiet,
        {
          ...account(BAD_DATE, 'Bad', AccountType.CASH, 3000),
          createdAt: 'nope',
        },
        // A string that parses is coerced and still limits visibility.
        {
          ...account(STRING_DATE, 'Stringy', AccountType.CASH, 4000),
          createdAt: '2026-02-10T00:00:00.000Z',
        },
      ]);
      transactionsService.sumLedgerDeltasByAccountAndMonth.mockResolvedValue(
        new Map([[NO_DATE_WITH_DELTA, new Map([['2026-03', 50]])]]),
      );

      const { months } = await service.getNetWorth(
        householdId,
        '2026-01',
        '2026-04',
      );

      expect(months.map((m) => Object.keys(balances(m)).sort())).toEqual([
        [BAD_DATE, NO_DATE_QUIET].sort(),
        [BAD_DATE, NO_DATE_QUIET, STRING_DATE].sort(),
        [BAD_DATE, NO_DATE_QUIET, NO_DATE_WITH_DELTA, STRING_DATE].sort(),
        [BAD_DATE, NO_DATE_QUIET, NO_DATE_WITH_DELTA, STRING_DATE].sort(),
      ]);
      expect(balances(months[2])[NO_DATE_WITH_DELTA]).toBe(1050);

      const dateWarnings = warn.mock.calls.filter(([, message]) =>
        /createdAt/.test(String(message)),
      );
      expect(dateWarnings).toHaveLength(1);
      expect(dateWarnings[0][0]).toEqual({
        householdId,
        accountIds: [NO_DATE_WITH_DELTA, NO_DATE_QUIET, BAD_DATE],
      });
    });

    it('counts an unknown account type in neither total and warns once with its id and type', async () => {
      const ODD = new Types.ObjectId().toString();
      accountsService.findAll.mockResolvedValue([
        account(CHECKING, 'Checking', AccountType.CHECKING, 100000),
        account(CREDIT, 'Card', AccountType.CREDIT, -20000),
        account(ODD, 'Crypto', 'crypto' as AccountType, 9999),
      ]);
      transactionsService.sumLedgerDeltasByAccountAndMonth.mockResolvedValue(
        new Map(),
      );

      const { months } = await service.getNetWorth(
        householdId,
        '2026-01',
        '2026-03',
      );

      for (const m of months) {
        expect(balances(m)[ODD]).toBe(9999);
        expect(m.assetsCents).toBe(100000);
        expect(m.liabilitiesCents).toBe(-20000);
        expect(m.netWorthCents).toBe(80000);
      }
      const typeWarnings = warn.mock.calls.filter(
        ([ctx]) => (ctx as { types?: string[] }).types !== undefined,
      );
      expect(typeWarnings).toHaveLength(1);
      expect(typeWarnings[0][0]).toEqual({
        householdId,
        accountIds: [ODD],
        types: ['crypto'],
      });
    });

    it('returns zero totals and empty account lists for a household with no accounts', async () => {
      accountsService.findAll.mockResolvedValue([]);
      transactionsService.sumLedgerDeltasByAccountAndMonth.mockResolvedValue(
        new Map(),
      );

      const { months } = await service.getNetWorth(
        householdId,
        '2026-01',
        '2026-02',
      );

      expect(months).toEqual([
        {
          month: '2026-01',
          assetsCents: 0,
          liabilitiesCents: 0,
          netWorthCents: 0,
          accounts: [],
        },
        {
          month: '2026-02',
          assetsCents: 0,
          liabilitiesCents: 0,
          netWorthCents: 0,
          accounts: [],
        },
      ]);
    });
  });
});
