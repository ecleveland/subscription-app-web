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
import { AccountsService } from '../accounts/accounts.service';
import { AccountType } from '../accounts/schemas/account.schema';
import { monthToUtcRange } from '../budgets/budget-month.util';
import { monthIndex, monthsInRange } from './month-range.util';
import type {
  CashFlowReport,
  CashFlowMonth,
} from './interfaces/cash-flow.interface';
import type {
  SpendingCategoryRow,
  SpendingReport,
} from './interfaces/spending.interface';
import type {
  NetWorthAccount,
  NetWorthMonth,
  NetWorthReport,
} from './interfaces/net-worth.interface';

// Account types whose balances count toward each net worth total. Liability
// balances are negative when money is owed. A type in neither set counts in
// neither total and is logged.
const ASSET_TYPES: ReadonlySet<AccountType> = new Set([
  AccountType.CHECKING,
  AccountType.SAVINGS,
  AccountType.CASH,
  AccountType.INVESTMENT,
]);
const LIABILITY_TYPES: ReadonlySet<AccountType> = new Set([
  AccountType.CREDIT,
  AccountType.LOAN,
]);

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    @InjectModel(Transaction.name)
    private readonly transactionModel: Model<TransactionDocument>,
    private readonly transactionsService: TransactionsService,
    private readonly budgetsService: BudgetsService,
    private readonly categoriesService: CategoriesService,
    private readonly accountsService: AccountsService,
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
   * drops spend with no categoryId or an orphaned one and this report keeps
   * it. Expense spend with no categoryId, an id the household does not have,
   * or an income category rolls into uncategorizedCents, so the rows plus
   * uncategorizedCents always add up to totalCents. Archived categories are
   * included so spend recorded before an archive keeps its name.
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

    const householdCategoryIds = new Set(
      categories.map((c) => c._id.toString()),
    );

    const actualByCat = new Map<string, number>();
    // Expense spend with no categoryId, or one the household does not have,
    // is a data-integrity problem, so it is logged ("null" for a missing id).
    // Spend on an income category is a user choice and is not.
    const orphanedSpend: string[] = [];
    let uncategorizedCents = 0;
    let totalCents = 0;
    for (const actual of actuals) {
      if (actual.type !== TransactionType.EXPENSE) {
        continue;
      }
      totalCents += actual.totalCents;
      const { categoryId } = actual;
      if (categoryId === null || !expenseCategories.has(categoryId)) {
        uncategorizedCents += actual.totalCents;
        if (categoryId === null) {
          orphanedSpend.push('null');
        } else if (!householdCategoryIds.has(categoryId)) {
          orphanedSpend.push(categoryId);
        }
        continue;
      }
      actualByCat.set(
        categoryId,
        (actualByCat.get(categoryId) ?? 0) + actual.totalCents,
      );
    }
    if (orphanedSpend.length > 0) {
      this.logger.warn(
        { householdId, month, categoryIds: orphanedSpend },
        'Spending report rolled spend on categories not in the household into uncategorizedCents',
      );
    }

    // A planned amount on a category the household does not have points at
    // nothing, so log it instead of dropping it without a trace. Plans on
    // income categories are a normal budget feature and simply get no row.
    const unplacedPlans = [...plannedByCat.keys()].filter(
      (categoryId) => !householdCategoryIds.has(categoryId),
    );
    if (unplacedPlans.length > 0) {
      this.logger.warn(
        { householdId, month, categoryIds: unplacedPlans },
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
        groupName: groupName ?? null,
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
        a.categoryName.localeCompare(b.categoryName, 'en'),
    );

    return { month, categories: rows, uncategorizedCents, totalCents };
  }

  /**
   * Each account's balance at the end of every UTC month from `from` to `to`
   * inclusive (both "YYYY-MM", already validated by the query DTO), with
   * asset, liability and net worth totals. Balances derive forward from
   * openingBalanceCents plus the signed ledger deltas dated before the next
   * month, which is the reconciliation invariant. The cached balanceCents is
   * never read. So a month before an account's first transaction shows its
   * opening balance, and a backdated transaction counts in the month it is
   * dated. An account appears only from the UTC month of its createdAt
   * onward. Earlier months leave it out of `accounts` and the totals, and
   * its first month still counts every delta dated before that month ends,
   * backdated ones included. Archived accounts are included because they
   * held money in the months the report covers.
   */
  async getNetWorth(
    householdId: string,
    from: string,
    to: string,
  ): Promise<NetWorthReport> {
    const { end } = monthToUtcRange(to);
    const [accounts, deltas] = await Promise.all([
      this.accountsService.findAll(householdId, true),
      this.transactionsService.sumLedgerDeltasByAccountAndMonth(
        householdId,
        end,
      ),
    ]);

    // Ledger rows on an account the household does not have point at
    // nothing, so log them instead of dropping cents without a trace.
    const accountIds = new Set(accounts.map((a) => a._id.toString()));
    const unknownAccounts = [...deltas.keys()].filter(
      (accountId) => !accountIds.has(accountId),
    );
    if (unknownAccounts.length > 0) {
      this.logger.warn(
        { householdId, accountIds: unknownAccounts },
        'Net worth report ignored ledger deltas on accounts not in the household',
      );
    }

    // Types outside both sets would otherwise vanish from the totals
    // without a trace.
    const unclassified = accounts.filter(
      (a) => !ASSET_TYPES.has(a.type) && !LIABILITY_TYPES.has(a.type),
    );
    if (unclassified.length > 0) {
      this.logger.warn(
        {
          householdId,
          accountIds: unclassified.map((a) => a._id.toString()),
          types: unclassified.map((a) => a.type),
        },
        'Net worth report left accounts of unknown type out of the totals',
      );
    }

    const months = monthsInRange(from, to);
    const fromIndex = monthIndex(from);
    const series = accounts.map((account) => {
      const byMonth =
        deltas.get(account._id.toString()) ?? new Map<string, number>();
      let balance = account.openingBalanceCents;
      for (const [month, deltaCents] of byMonth) {
        if (monthIndex(month) < fromIndex) {
          balance += deltaCents;
        }
      }
      const { createdAt } = account as unknown as { createdAt?: Date };
      return {
        account,
        // Months before this index are before the account existed. A
        // document with no createdAt shows in every month.
        firstMonthIndex: createdAt
          ? createdAt.getUTCFullYear() * 12 + createdAt.getUTCMonth()
          : -Infinity,
        // balances[m] is the balance at the end of months[m].
        balances: months.map((month) => {
          balance += byMonth.get(month) ?? 0;
          return balance;
        }),
      };
    });

    return {
      months: months.map((month, m): NetWorthMonth => {
        let assetsCents = 0;
        let liabilitiesCents = 0;
        const rows: NetWorthAccount[] = [];
        for (const { account, firstMonthIndex, balances } of series) {
          if (monthIndex(month) < firstMonthIndex) {
            continue;
          }
          const balanceCents = balances[m];
          if (ASSET_TYPES.has(account.type)) {
            assetsCents += balanceCents;
          } else if (LIABILITY_TYPES.has(account.type)) {
            liabilitiesCents += balanceCents;
          }
          rows.push({
            accountId: account._id.toString(),
            name: account.name,
            type: account.type,
            balanceCents,
          });
        }
        return {
          month,
          assetsCents,
          liabilitiesCents,
          netWorthCents: assetsCents + liabilitiesCents,
          accounts: rows,
        };
      }),
    };
  }
}
