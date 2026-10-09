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

type Row = {
  _id: { month: string; type: TransactionType };
  totalCents: number;
};

describe('ReportsService', () => {
  const householdId = new Types.ObjectId().toString();
  let service: ReportsService;
  let transactionModel: { aggregate: jest.Mock };
  let transactionsService: { aggregateMonthlyActualsByCategory: jest.Mock };
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
    };
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
});
