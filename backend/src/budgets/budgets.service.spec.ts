import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, Logger } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { BudgetsService } from './budgets.service';
import { Budget } from './schemas/budget.schema';
import { BudgetCategory } from './schemas/budget-category.schema';
import { TransactionsService } from '../transactions/transactions.service';
import { TransactionType } from '../transactions/schemas/transaction.schema';
import { CategoriesService } from '../categories/categories.service';

const HH = '507f191e810c19729de860ea';
const BUDGET_ID = new Types.ObjectId('507f191e810c19729de86099');
const CAT_EXP = '507f191e810c19729de86011';
const CAT_INC = '507f191e810c19729de86022';
const CAT_SPEND_ONLY = '507f191e810c19729de86033';

function createChainable(resolvedValue: any = null) {
  const chain: any = {};
  chain.sort = jest.fn().mockReturnValue(chain);
  chain.exec = jest.fn().mockResolvedValue(resolvedValue);
  return chain;
}

// A seeded category as listCategories returns it.
function cat(id: string, isIncome: boolean) {
  return { _id: new Types.ObjectId(id), isIncome };
}

function actual(
  categoryId: string,
  type: TransactionType.INCOME | TransactionType.EXPENSE,
  totalCents: number,
) {
  return { categoryId, type, totalCents };
}

describe('BudgetsService', () => {
  let service: BudgetsService;
  let budgetModel: any;
  let budgetCategoryModel: any;
  let transactionsService: { aggregateMonthlyActualsByCategory: jest.Mock };
  let categoriesService: {
    listCategories: jest.Mock;
    findInHousehold: jest.Mock;
  };

  beforeEach(async () => {
    budgetModel = {
      findOne: jest.fn().mockReturnValue(createChainable(null)),
      findOneAndUpdate: jest
        .fn()
        .mockReturnValue(createChainable({ _id: BUDGET_ID })),
    };
    budgetCategoryModel = {
      find: jest.fn().mockReturnValue(createChainable([])),
      updateOne: jest.fn().mockReturnValue(createChainable({})),
      deleteOne: jest
        .fn()
        .mockReturnValue(createChainable({ deletedCount: 1 })),
      bulkWrite: jest.fn().mockResolvedValue({}),
    };
    transactionsService = {
      aggregateMonthlyActualsByCategory: jest.fn().mockResolvedValue([]),
    };
    categoriesService = {
      listCategories: jest.fn().mockResolvedValue([]),
      findInHousehold: jest
        .fn()
        .mockResolvedValue({ _id: new Types.ObjectId(CAT_EXP) }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BudgetsService,
        { provide: getModelToken(Budget.name), useValue: budgetModel },
        {
          provide: getModelToken(BudgetCategory.name),
          useValue: budgetCategoryModel,
        },
        { provide: TransactionsService, useValue: transactionsService },
        { provide: CategoriesService, useValue: categoriesService },
      ],
    }).compile();

    service = module.get<BudgetsService>(BudgetsService);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => jest.clearAllMocks());

  // Make findBudget resolve to a budget doc (so planned limits load).
  function withExistingBudget() {
    budgetModel.findOne.mockReturnValue(createChainable({ _id: BUDGET_ID }));
  }
  function withPlanned(rows: { categoryId: string; plannedCents: number }[]) {
    budgetCategoryModel.find.mockReturnValue(
      createChainable(
        rows.map((r) => ({
          categoryId: new Types.ObjectId(r.categoryId),
          plannedCents: r.plannedCents,
        })),
      ),
    );
  }

  describe('getBudgetVsActual', () => {
    it('rejects a malformed month before touching the ledger', async () => {
      await expect(service.getBudgetVsActual(HH, '2026-13')).rejects.toThrow(
        BadRequestException,
      );
      expect(
        transactionsService.aggregateMonthlyActualsByCategory,
      ).not.toHaveBeenCalled();
    });

    it('passes the UTC month range to the aggregation', async () => {
      await service.getBudgetVsActual(HH, '2026-06');
      const [, start, end] =
        transactionsService.aggregateMonthlyActualsByCategory.mock.calls[0];
      expect(start.toISOString()).toBe('2026-06-01T00:00:00.000Z');
      expect(end.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    });

    it('returns an empty budget (all zeros) when nothing is planned or spent', async () => {
      const view = await service.getBudgetVsActual(HH, '2026-06');
      expect(view).toEqual({
        month: '2026-06',
        categories: [],
        totalPlannedCents: 0,
        totalActualCents: 0,
        incomeCents: 0,
        toBeBudgetedCents: 0,
      });
    });

    it('shows a planned category with no spend as actual 0 / full remaining', async () => {
      withExistingBudget();
      withPlanned([{ categoryId: CAT_EXP, plannedCents: 50000 }]);
      categoriesService.listCategories.mockResolvedValue([cat(CAT_EXP, false)]);

      const view = await service.getBudgetVsActual(HH, '2026-06');
      expect(view.categories).toEqual([
        {
          categoryId: CAT_EXP,
          plannedCents: 50000,
          actualCents: 0,
          remainingCents: 50000,
          isIncome: false,
        },
      ]);
      expect(view.totalPlannedCents).toBe(50000);
      expect(view.totalActualCents).toBe(0);
    });

    it('includes a category with spend but no limit (overspend visible, negative remaining)', async () => {
      categoriesService.listCategories.mockResolvedValue([
        cat(CAT_SPEND_ONLY, false),
      ]);
      transactionsService.aggregateMonthlyActualsByCategory.mockResolvedValue([
        actual(CAT_SPEND_ONLY, TransactionType.EXPENSE, 7500),
      ]);

      const view = await service.getBudgetVsActual(HH, '2026-06');
      expect(view.categories).toEqual([
        {
          categoryId: CAT_SPEND_ONLY,
          plannedCents: 0,
          actualCents: 7500,
          remainingCents: -7500,
          isIncome: false,
        },
      ]);
      expect(view.totalActualCents).toBe(7500);
    });

    it('routes income vs expense actuals by the category isIncome flag', async () => {
      withExistingBudget();
      withPlanned([{ categoryId: CAT_EXP, plannedCents: 40000 }]);
      categoriesService.listCategories.mockResolvedValue([
        cat(CAT_EXP, false),
        cat(CAT_INC, true),
      ]);
      transactionsService.aggregateMonthlyActualsByCategory.mockResolvedValue([
        actual(CAT_EXP, TransactionType.EXPENSE, 45000),
        actual(CAT_INC, TransactionType.INCOME, 310000),
      ]);

      const view = await service.getBudgetVsActual(HH, '2026-06');

      const exp = view.categories.find((c) => c.categoryId === CAT_EXP);
      const inc = view.categories.find((c) => c.categoryId === CAT_INC);
      expect(exp).toMatchObject({ actualCents: 45000, remainingCents: -5000 });
      expect(inc).toMatchObject({ actualCents: 310000, isIncome: true });

      // Rollups are expense-only; income lands in incomeCents.
      expect(view.totalPlannedCents).toBe(40000);
      expect(view.totalActualCents).toBe(45000);
      expect(view.incomeCents).toBe(310000);
      expect(view.toBeBudgetedCents).toBe(310000 - 40000);
    });

    it('sums multiple income transactions into incomeCents', async () => {
      categoriesService.listCategories.mockResolvedValue([cat(CAT_INC, true)]);
      transactionsService.aggregateMonthlyActualsByCategory.mockResolvedValue([
        actual(CAT_INC, TransactionType.INCOME, 200000),
        actual(CAT_INC, TransactionType.INCOME, 110000),
      ]);

      const view = await service.getBudgetVsActual(HH, '2026-06');
      expect(view.incomeCents).toBe(310000);
      expect(
        view.categories.find((c) => c.categoryId === CAT_INC)?.actualCents,
      ).toBe(310000);
    });

    it('excludes an income category’s planned limit from totalPlannedCents', async () => {
      withExistingBudget();
      withPlanned([{ categoryId: CAT_INC, plannedCents: 100000 }]);
      categoriesService.listCategories.mockResolvedValue([cat(CAT_INC, true)]);

      const view = await service.getBudgetVsActual(HH, '2026-06');
      // The income category still appears as a row...
      expect(view.categories).toHaveLength(1);
      expect(view.categories[0]).toMatchObject({
        categoryId: CAT_INC,
        plannedCents: 100000,
        isIncome: true,
      });
      // ...but its planned limit does not inflate the (expense-only) rollup.
      expect(view.totalPlannedCents).toBe(0);
      expect(view.totalActualCents).toBe(0);
    });

    it('drops actuals for a category not in the household', async () => {
      categoriesService.listCategories.mockResolvedValue([]); // unknown category
      transactionsService.aggregateMonthlyActualsByCategory.mockResolvedValue([
        actual(CAT_SPEND_ONLY, TransactionType.EXPENSE, 5000),
      ]);

      const view = await service.getBudgetVsActual(HH, '2026-06');
      expect(view.categories).toEqual([]);
      expect(view.totalActualCents).toBe(0);
    });
  });

  describe('setBudgetCategory', () => {
    it('rejects a foreign categoryId without writing', async () => {
      categoriesService.findInHousehold.mockResolvedValue(null);
      await expect(
        service.setBudgetCategory(HH, '2026-06', CAT_EXP, 5000),
      ).rejects.toThrow(BadRequestException);
      expect(budgetModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(budgetCategoryModel.updateOne).not.toHaveBeenCalled();
    });

    it('rejects a malformed month', async () => {
      await expect(
        service.setBudgetCategory(HH, '2026-1', CAT_EXP, 5000),
      ).rejects.toThrow(BadRequestException);
    });

    it('auto-creates the budget and upserts the planned limit', async () => {
      await service.setBudgetCategory(HH, '2026-06', CAT_EXP, 50000);
      expect(budgetModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
      expect(budgetCategoryModel.updateOne).toHaveBeenCalledTimes(1);
      const [filter, update, options] =
        budgetCategoryModel.updateOne.mock.calls[0];
      expect(filter.budgetId).toEqual(BUDGET_ID);
      expect(update.$set).toEqual({ plannedCents: 50000 });
      expect(options).toEqual({ upsert: true });
    });

    it('re-reads the budget when the auto-create loses a duplicate-key race', async () => {
      budgetModel.findOneAndUpdate.mockReturnValue({
        exec: jest
          .fn()
          .mockRejectedValue(Object.assign(new Error(), { code: 11000 })),
      });
      budgetModel.findOne.mockReturnValue(createChainable({ _id: BUDGET_ID }));

      await service.setBudgetCategory(HH, '2026-06', CAT_EXP, 50000);
      expect(budgetCategoryModel.updateOne).toHaveBeenCalledTimes(1);
    });

    it('surfaces a descriptive error if the dup-key race re-read finds nothing', async () => {
      budgetModel.findOneAndUpdate.mockReturnValue({
        exec: jest
          .fn()
          .mockRejectedValue(Object.assign(new Error(), { code: 11000 })),
      });
      budgetModel.findOne.mockReturnValue(createChainable(null));

      await expect(
        service.setBudgetCategory(HH, '2026-06', CAT_EXP, 50000),
      ).rejects.toThrow(/duplicate-key race/);
      expect(budgetCategoryModel.updateOne).not.toHaveBeenCalled();
    });
  });

  describe('bulkSetBudgetCategories', () => {
    it('rejects the whole batch if any categoryId is foreign', async () => {
      categoriesService.listCategories.mockResolvedValue([cat(CAT_EXP, false)]);
      await expect(
        service.bulkSetBudgetCategories(HH, '2026-06', [
          { categoryId: CAT_EXP, plannedCents: 1000 },
          { categoryId: CAT_INC, plannedCents: 2000 },
        ]),
      ).rejects.toThrow(BadRequestException);
      expect(budgetCategoryModel.bulkWrite).not.toHaveBeenCalled();
    });

    it('upserts all limits in one bulkWrite and returns the recomputed view', async () => {
      categoriesService.listCategories.mockResolvedValue([
        cat(CAT_EXP, false),
        cat(CAT_INC, true),
      ]);

      const view = await service.bulkSetBudgetCategories(HH, '2026-06', [
        { categoryId: CAT_EXP, plannedCents: 1000 },
        { categoryId: CAT_INC, plannedCents: 2000 },
      ]);

      expect(budgetCategoryModel.bulkWrite).toHaveBeenCalledTimes(1);
      const ops = budgetCategoryModel.bulkWrite.mock.calls[0][0];
      expect(ops).toHaveLength(2);
      expect(ops[0].updateOne.update.$set).toEqual({ plannedCents: 1000 });
      expect(ops[0].updateOne.upsert).toBe(true);
      expect(view.month).toBe('2026-06');
    });

    it('writes nothing for an empty list but still returns a view', async () => {
      const view = await service.bulkSetBudgetCategories(HH, '2026-06', []);
      expect(budgetCategoryModel.bulkWrite).not.toHaveBeenCalled();
      expect(view.month).toBe('2026-06');
    });
  });

  describe('deleteBudgetCategory', () => {
    it('is a no-op when no budget exists for the month', async () => {
      budgetModel.findOne.mockReturnValue(createChainable(null));
      await service.deleteBudgetCategory(HH, '2026-06', CAT_EXP);
      expect(budgetCategoryModel.deleteOne).not.toHaveBeenCalled();
    });

    it('deletes the row scoped to the budget and category', async () => {
      budgetModel.findOne.mockReturnValue(createChainable({ _id: BUDGET_ID }));
      await service.deleteBudgetCategory(HH, '2026-06', CAT_EXP);
      expect(budgetCategoryModel.deleteOne).toHaveBeenCalledTimes(1);
      const [filter] = budgetCategoryModel.deleteOne.mock.calls[0];
      expect(filter.budgetId).toEqual(BUDGET_ID);
      expect(filter.categoryId).toEqual(new Types.ObjectId(CAT_EXP));
    });

    it('rejects a malformed month', async () => {
      await expect(
        service.deleteBudgetCategory(HH, 'nope', CAT_EXP),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
