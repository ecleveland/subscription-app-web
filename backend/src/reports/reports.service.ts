import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import {
  ReimbursementStatus,
  Transaction,
  TransactionDocument,
  TransactionType,
} from '../transactions/schemas/transaction.schema';
import { TransactionsService } from '../transactions/transactions.service';
import { BudgetsService } from '../budgets/budgets.service';
import { CategoriesService } from '../categories/categories.service';
import { AccountsService } from '../accounts/accounts.service';
import { LabelsService } from '../labels/labels.service';
import { LABEL_FILTER_ANY } from '../labels/dto/label-filter';
import type { CategoryDocument } from '../categories/schemas/category.schema';
import type { CategoryGroupDocument } from '../categories/schemas/category-group.schema';
import {
  ASSET_TYPES,
  LIABILITY_TYPES,
} from '../accounts/schemas/account.schema';
import { monthToUtcRange } from '../budgets/budget-month.util';
import {
  monthIndex,
  monthIndexOfDate,
  monthsInRange,
} from './month-range.util';
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
import type {
  BusinessMonth,
  BusinessReimbursementRow,
  BusinessReport,
} from './interfaces/business.interface';

// One expense actual keyed by category, as the category rows read it.
interface CategoryActual {
  categoryId: string | null;
  totalCents: number;
}

// The four sub-pipelines of the business report's single $facet pass.
interface BusinessFacet {
  months: {
    _id: { month: string; type: TransactionType };
    totalCents: number;
  }[];
  reimbursedByMonth: { _id: string; totalCents: number }[];
  categories: { _id: Types.ObjectId | null; totalCents: number }[];
  totals: { _id: ReimbursementStatus; totalCents: number; count: number }[];
}

// Group key for the UTC "YYYY-MM" of a transaction's date.
const UTC_MONTH = {
  $dateToString: { format: '%Y-%m', date: '$date', timezone: 'UTC' },
};

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
    private readonly labelsService: LabelsService,
  ) {}

  /**
   * Income and expense totals per UTC month from `from` to `to` inclusive
   * (both "YYYY-MM", already validated by the query DTO). One aggregation over
   * the ledger, grouped by month and type. Transfers are excluded because they
   * move money between the household's own accounts. Expenses count on every
   * account type, credit cards included. Months with no activity come back as
   * zeros so the caller can chart the range without gaps. `labelId` narrows
   * the ledger with LabelsService.reportLabelMatch.
   */
  async getCashFlow(
    householdId: string,
    from: string,
    to: string,
    labelId?: string,
  ): Promise<CashFlowReport> {
    const { start } = monthToUtcRange(from);
    const { end } = monthToUtcRange(to);
    const labelMatch = await this.labelsService.reportLabelMatch(
      householdId,
      labelId,
    );

    const pipeline: PipelineStage[] = [
      {
        $match: {
          householdId: new Types.ObjectId(householdId),
          ...labelMatch,
          type: { $in: [TransactionType.INCOME, TransactionType.EXPENSE] },
          date: { $gte: start, $lt: end },
        },
      },
      {
        $group: {
          _id: { month: UTC_MONTH, type: '$type' },
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
   * included so spend recorded before an archive keeps its name. `labelId`
   * narrows the actuals with LabelsService.reportLabelMatch. Planned amounts
   * are not per label, so they stay as they are.
   */
  async getSpending(
    householdId: string,
    month: string,
    labelId?: string,
  ): Promise<SpendingReport> {
    const { start, end } = monthToUtcRange(month);
    const labelMatch = await this.labelsService.reportLabelMatch(
      householdId,
      labelId,
    );
    const [actuals, plannedByCat, categories, groups] = await Promise.all([
      this.transactionsService.aggregateMonthlyActualsByCategory(
        householdId,
        start,
        end,
        labelMatch,
      ),
      this.budgetsService.getPlannedByCategory(householdId, month),
      this.categoriesService.listCategories(householdId, true),
      this.categoriesService.listGroups(householdId),
    ]);

    const { rows, uncategorizedCents, totalCents } = this.buildCategoryRows(
      'Spending report',
      { householdId, month },
      categories,
      groups,
      actuals.filter((a) => a.type === TransactionType.EXPENSE),
      plannedByCat,
    );
    // A planned amount on a category the household does not have points at
    // nothing, so log it instead of dropping it without a trace. Plans on
    // income categories are a normal budget feature and simply get no row.
    const householdCategoryIds = new Set(
      categories.map((c) => c._id.toString()),
    );
    const unplacedPlans = [...plannedByCat.keys()].filter(
      (categoryId) => !householdCategoryIds.has(categoryId),
    );
    if (unplacedPlans.length > 0) {
      this.logger.warn(
        { householdId, month, categoryIds: unplacedPlans },
        'Spending report skipped planned rows on categories not in the household',
      );
    }

    return { month, categories: rows, uncategorizedCents, totalCents };
  }

  /**
   * Labeled income and expense per UTC month from `from` to `to` inclusive
   * (both "YYYY-MM", already validated by the query DTO), expense spend by
   * category over the range, and the reimbursable expenses in it. `labelId`
   * picks one label with its sub-labels. Omitted, the report covers every
   * labeled record. Expense totals are gross. A reimbursed expense still
   * counts as spend, and reimbursedCents shows how much of it came back.
   * The owed list and owedCents cover every expense still owed that is dated
   * before the end of the range, with no lower bound. So a one-month report
   * still shows money owed from earlier months. The reimbursed list and
   * reimbursedCents stay inside the range like the months, categories and
   * totals. One $facet pass reads the sums and one find reads the
   * reimbursement rows.
   */
  async getBusiness(
    householdId: string,
    from: string,
    to: string,
    labelId?: string,
  ): Promise<BusinessReport> {
    const { start } = monthToUtcRange(from);
    const { end } = monthToUtcRange(to);
    const labelMatch = await this.labelsService.reportLabelMatch(
      householdId,
      labelId ?? LABEL_FILTER_ANY,
    );
    const scope = {
      householdId: new Types.ObjectId(householdId),
      ...labelMatch,
    };
    const inRange = { date: { $gte: start } };
    const stillOwed = {
      type: TransactionType.EXPENSE,
      'reimbursement.status': ReimbursementStatus.OWED,
    };
    // Expenses still owed from any earlier date, or reimbursed in the range.
    const reimbursableScope = [
      { 'reimbursement.status': ReimbursementStatus.OWED },
      { 'reimbursement.status': ReimbursementStatus.REIMBURSED, ...inRange },
    ];
    const sumAmount = { $sum: '$amountCents' };

    // The outer match reads the range plus older owed expenses. Every
    // sub-pipeline except totals narrows back to the range.
    const pipeline: PipelineStage[] = [
      {
        $match: {
          ...scope,
          type: { $in: [TransactionType.INCOME, TransactionType.EXPENSE] },
          date: { $lt: end },
          $or: [inRange, stillOwed],
        },
      },
      {
        $facet: {
          months: [
            { $match: inRange },
            {
              $group: {
                _id: { month: UTC_MONTH, type: '$type' },
                totalCents: sumAmount,
              },
            },
          ],
          reimbursedByMonth: [
            {
              $match: {
                ...inRange,
                type: TransactionType.EXPENSE,
                'reimbursement.status': ReimbursementStatus.REIMBURSED,
              },
            },
            { $group: { _id: UTC_MONTH, totalCents: sumAmount } },
          ],
          categories: [
            { $match: { ...inRange, type: TransactionType.EXPENSE } },
            { $group: { _id: '$categoryId', totalCents: sumAmount } },
          ],
          totals: [
            {
              $match: {
                type: TransactionType.EXPENSE,
                $or: reimbursableScope,
              },
            },
            {
              $group: {
                _id: '$reimbursement.status',
                totalCents: sumAmount,
                count: { $sum: 1 },
              },
            },
          ],
        },
      },
    ];

    const [facetRows, reimbursable, categories, groups] = await Promise.all([
      this.transactionModel.aggregate(pipeline).exec() as unknown as Promise<
        BusinessFacet[]
      >,
      this.transactionModel
        .find({
          ...scope,
          type: TransactionType.EXPENSE,
          date: { $lt: end },
          $or: reimbursableScope,
        } as Record<string, unknown>)
        .select('date payee amountCents categoryId labelId reimbursement')
        .sort({ date: 1 })
        .exec(),
      this.categoriesService.listCategories(householdId, true),
      this.categoriesService.listGroups(householdId),
    ]);
    // $facet always yields one document. The fallback keeps a mocked or
    // empty result from crashing the report.
    const facet: BusinessFacet = facetRows[0] ?? {
      months: [],
      reimbursedByMonth: [],
      categories: [],
      totals: [],
    };

    const byMonth = new Map<string, BusinessMonth>(
      monthsInRange(from, to).map((month) => [
        month,
        { month, expenseCents: 0, incomeCents: 0, reimbursedCents: 0 },
      ]),
    );
    // Unreachable while the $match range and the zero-filled months agree.
    // Warn so a range bug shows up instead of cents silently vanishing.
    const entryFor = (month: string): BusinessMonth | undefined => {
      const entry = byMonth.get(month);
      if (!entry) {
        this.logger.warn(
          { householdId, month },
          'Dropped a business report row outside the range',
        );
      }
      return entry;
    };
    for (const row of facet.months) {
      const entry = entryFor(row._id.month);
      if (!entry) {
        continue;
      }
      if (row._id.type === TransactionType.INCOME) {
        entry.incomeCents += row.totalCents;
      } else {
        entry.expenseCents += row.totalCents;
      }
    }
    for (const row of facet.reimbursedByMonth) {
      const entry = entryFor(row._id);
      if (entry) {
        entry.reimbursedCents += row.totalCents;
      }
    }

    const { rows, uncategorizedCents, totalCents } = this.buildCategoryRows(
      'Business report',
      { householdId, from, to },
      categories,
      groups,
      facet.categories.map((c) => ({
        categoryId: c._id == null ? null : c._id.toString(),
        totalCents: c.totalCents,
      })),
      new Map(),
    );

    const totalFor = (status: ReimbursementStatus) =>
      facet.totals.find((t) => t._id === status);
    const owedTotal = totalFor(ReimbursementStatus.OWED);
    const reimbursedTotal = totalFor(ReimbursementStatus.REIMBURSED);

    const owed: BusinessReimbursementRow[] = [];
    const reimbursed: BusinessReimbursementRow[] = [];
    for (const doc of reimbursable) {
      const row = this.reimbursementRow(doc);
      if (doc.reimbursement?.status === ReimbursementStatus.REIMBURSED) {
        reimbursed.push(row);
      } else {
        owed.push(row);
      }
    }
    reimbursed.reverse();

    return {
      from,
      to,
      labelId: labelId ?? null,
      months: [...byMonth.values()],
      categories: rows,
      uncategorizedCents,
      totalCents,
      reimbursements: {
        owedCents: owedTotal?.totalCents ?? 0,
        owedCount: owedTotal?.count ?? 0,
        reimbursedCents: reimbursedTotal?.totalCents ?? 0,
        owed,
        reimbursed,
      },
    };
  }

  // One reimbursable expense as the business report lists it. Ids become hex
  // strings and dates ISO strings. Reimbursed rows also carry when the money
  // came back and the linked income, or null when none is linked.
  private reimbursementRow(doc: TransactionDocument): BusinessReimbursementRow {
    const hex = (id: unknown) =>
      id == null ? null : (id as Types.ObjectId).toString();
    const row: BusinessReimbursementRow = {
      id: doc._id.toString(),
      date: doc.date.toISOString(),
      payee: doc.payee ?? null,
      amountCents: doc.amountCents,
      categoryId: hex(doc.categoryId),
      // The report's match requires a label, so the fallback never applies.
      labelId: hex(doc.labelId) ?? '',
    };
    const block = doc.reimbursement;
    if (block?.status === ReimbursementStatus.REIMBURSED) {
      row.reimbursedAt = block.reimbursedAt?.toISOString();
      row.reimbursedByTransactionId = hex(block.reimbursedByTransactionId);
    }
    return row;
  }

  /**
   * Expense category rows shared by the spending and business reports.
   * `actuals` are expense spend per categoryId. Spend with no categoryId, an
   * id the household does not have, or an income category rolls into
   * uncategorizedCents, so the rows plus uncategorizedCents always add up to
   * totalCents. A missing or foreign id is a data-integrity problem and is
   * logged under `report` with `logContext`. An expense category gets a row
   * when it has spend or a planned amount. Rows sort by actualCents
   * descending, then categoryName ascending.
   */
  private buildCategoryRows(
    report: string,
    logContext: Record<string, unknown>,
    categories: CategoryDocument[],
    groups: CategoryGroupDocument[],
    actuals: CategoryActual[],
    plannedByCat: Map<string, number>,
  ): {
    rows: SpendingCategoryRow[];
    uncategorizedCents: number;
    totalCents: number;
  } {
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
        { ...logContext, categoryIds: orphanedSpend },
        `${report} rolled spend on categories not in the household into uncategorizedCents`,
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
        { ...logContext, categoryIds: missingGroup },
        `${report} found categories whose group does not exist`,
      );
    }

    rows.sort(
      (a, b) =>
        b.actualCents - a.actualCents ||
        a.categoryName.localeCompare(b.categoryName, 'en'),
    );
    return { rows, uncategorizedCents, totalCents };
  }

  /**
   * Each account's balance at the end of every UTC month from `from` to `to`
   * inclusive (both "YYYY-MM", already validated by the query DTO), with
   * asset, liability and net worth totals. Balances derive forward from
   * openingBalanceCents plus the signed ledger deltas dated before the next
   * month, which is the reconciliation invariant. The cached balanceCents is
   * never read, and a backdated transaction counts in the month it is dated.
   * An account appears from the earlier of the UTC month of its createdAt and
   * its earliest month with a ledger delta. So entering past transactions on
   * a new account shows its history, and a backdated transfer into a newer
   * account shows both legs. Earlier months leave it out of `accounts` and
   * the totals. Once it appears, a month with no deltas repeats the prior
   * balance, starting from openingBalanceCents. A missing or unparseable
   * createdAt sets no creation limit and is logged. Archived accounts are
   * included because they held money in the months the report covers.
   * `labelId` narrows the ledger deltas with LabelsService.reportLabelMatch.
   * Transfers carry no label, so a label id drops them and 'none' keeps
   * them. Opening balances always count.
   */
  async getNetWorth(
    householdId: string,
    from: string,
    to: string,
    labelId?: string,
  ): Promise<NetWorthReport> {
    const { end } = monthToUtcRange(to);
    const labelMatch = await this.labelsService.reportLabelMatch(
      householdId,
      labelId,
    );
    const [accounts, deltas] = await Promise.all([
      this.accountsService.findAll(householdId, true),
      this.transactionsService.sumLedgerDeltasByAccountAndMonth(
        householdId,
        end,
        labelMatch,
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
    const undated: string[] = [];
    const series = accounts.map((account) => {
      const byMonth =
        deltas.get(account._id.toString()) ?? new Map<string, number>();
      let balance = account.openingBalanceCents;
      for (const [month, deltaCents] of byMonth) {
        if (monthIndex(month) < fromIndex) {
          balance += deltaCents;
        }
      }
      // The account shows from the earlier of its creation month and its
      // first delta month. With neither, it shows in every month.
      const firstMonths = [...byMonth.keys()].map(monthIndex);
      const createdIndex = this.creationMonthIndex(account);
      if (createdIndex === null) {
        undated.push(account._id.toString());
      } else {
        firstMonths.push(createdIndex);
      }
      return {
        account,
        firstMonthIndex:
          firstMonths.length > 0 ? Math.min(...firstMonths) : -Infinity,
        // balances[m] is the balance at the end of months[m].
        balances: months.map((month) => {
          balance += byMonth.get(month) ?? 0;
          return balance;
        }),
      };
    });
    if (undated.length > 0) {
      this.logger.warn(
        { householdId, accountIds: undated },
        'Net worth report found accounts with a missing or invalid createdAt',
      );
    }

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
          // ASSET_TYPES and LIABILITY_TYPES decide which total a balance
          // counts toward. A type in neither set counts in neither total and
          // was logged above.
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

  // The monthIndex of an account's createdAt, or null when it is missing or
  // does not parse. Lean or legacy documents may carry a string.
  private creationMonthIndex(account: unknown): number | null {
    const { createdAt } = account as { createdAt?: unknown };
    if (createdAt == null) {
      return null;
    }
    const date =
      createdAt instanceof Date
        ? createdAt
        : new Date(createdAt as string | number);
    return Number.isNaN(date.getTime()) ? null : monthIndexOfDate(date);
  }
}
