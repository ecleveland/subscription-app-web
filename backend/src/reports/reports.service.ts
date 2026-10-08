import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import {
  Transaction,
  TransactionDocument,
  TransactionType,
} from '../transactions/schemas/transaction.schema';
import { TransactionsService } from '../transactions/transactions.service';
import { BudgetsService } from '../budgets/budgets.service';
import { CategoriesService } from '../categories/categories.service';
import { monthToUtcRange } from '../budgets/budget-month.util';
import { monthsInRange } from './month-range.util';
import type {
  CashFlowReport,
  CashFlowMonth,
} from './interfaces/cash-flow.interface';
import type {
  SpendingCategoryRow,
  SpendingReport,
} from './interfaces/spending.interface';

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    @InjectModel(Transaction.name)
    private readonly transactionModel: Model<TransactionDocument>,
    private readonly transactionsService: TransactionsService,
    private readonly budgetsService: BudgetsService,
    private readonly categoriesService: CategoriesService,
  ) {}

  /**
   * Income and expense totals per UTC month from `from` to `to` inclusive
   * (both "YYYY-MM", already validated by the query DTO). One aggregation over
   * the ledger, grouped by month and type. Transfers are excluded because they
   * move money between the household's own accounts. Expenses count on every
   * account type, credit cards included. Months with no activity come back as
   * zeros so the caller can chart the range without gaps.
   */
  async getCashFlow(
    householdId: string,
    from: string,
    to: string,
  ): Promise<CashFlowReport> {
    const { start } = monthToUtcRange(from);
    const { end } = monthToUtcRange(to);

    const pipeline: PipelineStage[] = [
      {
        $match: {
          householdId: new Types.ObjectId(householdId),
          type: { $in: [TransactionType.INCOME, TransactionType.EXPENSE] },
          date: { $gte: start, $lt: end },
        },
      },
      {
        $group: {
          _id: {
            month: {
              $dateToString: {
                format: '%Y-%m',
                date: '$date',
                timezone: 'UTC',
              },
            },
            type: '$type',
          },
          totalCents: { $sum: '$amountCents' },
        },
      },
    ];

    const rows = (await this.transactionModel
      .aggregate(pipeline)
      .exec()) as unknown as {
      _id: { month: string; type: TransactionType };
      totalCents: number;
    }[];

    const byMonth = new Map<string, CashFlowMonth>(
      monthsInRange(from, to).map((month) => [
        month,
        { month, incomeCents: 0, expenseCents: 0, netCents: 0 },
      ]),
    );
    for (const row of rows) {
      const entry = byMonth.get(row._id.month);
      // Unreachable while the $match range and the zero-filled months agree.
      // Warn if it ever happens so a range bug shows up instead of cents
      // silently vanishing from the report.
      if (!entry) {
        this.logger.warn(
          { householdId, month: row._id.month },
          'Dropped a cash flow row outside the requested range',
        );
        continue;
      }
      if (row._id.type === TransactionType.INCOME) {
        entry.incomeCents += row.totalCents;
      } else {
        entry.expenseCents += row.totalCents;
      }
    }

    const months = [...byMonth.values()];
    for (const m of months) {
      m.netCents = m.incomeCents - m.expenseCents;
    }
    return { months };
  }

  /**
   * One month's expense spend per category with that month's planned amount
   * alongside (`month` is "YYYY-MM", already validated by the query DTO).
   * Per-category actuals match the budget view because they come from the
   * same aggregation. The totals differ by design because the budget view
   * drops orphaned spend and this report keeps it. Expense spend on a
   * category that is not a live expense category of the household (an
   * unknown id or an income category) rolls into uncategorizedCents, so the
   * rows plus uncategorizedCents always add up to totalCents. Archived
   * categories are included so spend recorded before an archive keeps its
   * name.
   */
  async getSpending(
    householdId: string,
    month: string,
  ): Promise<SpendingReport> {
    const { start, end } = monthToUtcRange(month);
    const [actuals, plannedByCat, categories, groups] = await Promise.all([
      this.transactionsService.aggregateMonthlyActualsByCategory(
        householdId,
        start,
        end,
      ),
      this.budgetsService.getPlannedByCategory(householdId, month),
      this.categoriesService.listCategories(householdId, true),
      this.categoriesService.listGroups(householdId),
    ]);

    const groupNames = new Map(
      groups.map((g) => [g._id.toString(), g.name] as const),
    );
    // Only expense categories get rows. Anything else is uncategorized here.
    const expenseCategories = new Map(
      categories
        .filter((c) => !c.isIncome)
        .map((c) => [c._id.toString(), c] as const),
    );

    const actualByCat = new Map<string, number>();
    let uncategorizedCents = 0;
    let totalCents = 0;
    for (const actual of actuals) {
      if (actual.type !== TransactionType.EXPENSE) {
        continue;
      }
      totalCents += actual.totalCents;
      if (!expenseCategories.has(actual.categoryId)) {
        uncategorizedCents += actual.totalCents;
        continue;
      }
      actualByCat.set(
        actual.categoryId,
        (actualByCat.get(actual.categoryId) ?? 0) + actual.totalCents,
      );
    }

    // A planned amount on a category the household does not have points at
    // nothing, so log it instead of dropping it without a trace. Plans on
    // income categories are a normal budget feature and simply get no row.
    const householdCategoryIds = new Set(
      categories.map((c) => c._id.toString()),
    );
    const unplacedPlans = [...plannedByCat.keys()].filter(
      (categoryId) => !householdCategoryIds.has(categoryId),
    ).length;
    if (unplacedPlans > 0) {
      this.logger.warn(
        { householdId, month, count: unplacedPlans },
        'Spending report skipped planned rows on categories not in the household',
      );
    }

    const rows: SpendingCategoryRow[] = [];
    const missingGroup: string[] = [];
    for (const [categoryId, category] of expenseCategories) {
      const actualCents = actualByCat.get(categoryId);
      const plannedCents = plannedByCat.get(categoryId);
      if (actualCents === undefined && plannedCents === undefined) {
        continue;
      }
      const groupId = (
        category.groupId as unknown as Types.ObjectId
      ).toString();
      const groupName = groupNames.get(groupId);
      if (groupName === undefined) {
        missingGroup.push(categoryId);
      }
      rows.push({
        categoryId,
        categoryName: category.name,
        groupId,
        groupName: groupName ?? '',
        actualCents: actualCents ?? 0,
        plannedCents: plannedCents ?? null,
      });
    }
    if (missingGroup.length > 0) {
      this.logger.warn(
        { householdId, month, categoryIds: missingGroup },
        'Spending report found categories whose group does not exist',
      );
    }

    rows.sort(
      (a, b) =>
        b.actualCents - a.actualCents ||
        a.categoryName.localeCompare(b.categoryName),
    );

    return { month, categories: rows, uncategorizedCents, totalCents };
  }
}
