import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AnyBulkWriteOperation, Model, Types } from 'mongoose';
import { Budget, BudgetDocument } from './schemas/budget.schema';
import {
  BudgetCategory,
  BudgetCategoryDocument,
} from './schemas/budget-category.schema';
import { isValidMonth, monthToUtcRange } from './budget-month.util';
import { BudgetCategoryView, BudgetView } from './dto/budget-view.interface';
import { BulkBudgetCategoryLimitDto } from './dto/bulk-set-budget.dto';
import {
  TransactionsService,
  MonthlyCategoryActual,
} from '../transactions/transactions.service';
import { TransactionType } from '../transactions/schemas/transaction.schema';
import { CategoriesService } from '../categories/categories.service';

// MongoDB duplicate-key error code. A concurrent first-write to the same
// (household, month) can lose the auto-create upsert race; the budget it tried
// to insert already exists, which is the desired end state, so we re-read it.
const DUPLICATE_KEY = 11000;

function isDuplicateKeyError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as { code: number }).code === DUPLICATE_KEY
  );
}

@Injectable()
export class BudgetsService {
  private readonly logger = new Logger(BudgetsService.name);

  constructor(
    @InjectModel(Budget.name)
    private readonly budgetModel: Model<BudgetDocument>,
    @InjectModel(BudgetCategory.name)
    private readonly budgetCategoryModel: Model<BudgetCategoryDocument>,
    private readonly transactionsService: TransactionsService,
    private readonly categoriesService: CategoriesService,
  ) {}

  /**
   * Compute the budget-vs-actual view for a household's month. Read-only: it
   * does NOT create a Budget document (a GET never writes). Planned limits come
   * from any existing Budget's BudgetCategory rows; actuals are aggregated from
   * the transaction ledger. The category rows are the union of {categories with
   * a planned limit} ∪ {categories with spend this month}, so both unspent
   * allocations and unbudgeted overspend are visible.
   */
  async getBudgetVsActual(
    householdId: string,
    month: string,
  ): Promise<BudgetView> {
    this.assertValidMonth(month);
    const { start, end } = monthToUtcRange(month);

    const budget = await this.findBudget(householdId, month);
    const [plannedByCat, actuals, categories] = await Promise.all([
      this.loadPlannedByCategory(budget),
      this.transactionsService.aggregateMonthlyActualsByCategory(
        householdId,
        start,
        end,
      ),
      this.categoriesService.listCategories(householdId, true),
    ]);

    const incomeByCat = this.sumByCategory(actuals, TransactionType.INCOME);
    const expenseByCat = this.sumByCategory(actuals, TransactionType.EXPENSE);

    // Union of categories that have a planned limit OR spend this month.
    const inUnion = (categoryId: string): boolean =>
      plannedByCat.has(categoryId) ||
      incomeByCat.has(categoryId) ||
      expenseByCat.has(categoryId);

    const rows: BudgetCategoryView[] = [];
    let totalPlannedCents = 0;
    let totalActualCents = 0;
    // Iterate in the categories' display order (sorted by sortOrder); this also
    // naturally drops actuals on any orphaned category not in the household.
    for (const category of categories) {
      const categoryId = category._id.toString();
      if (!inUnion(categoryId)) {
        continue;
      }
      const plannedCents = plannedByCat.get(categoryId) ?? 0;
      const actualCents = category.isIncome
        ? (incomeByCat.get(categoryId) ?? 0)
        : (expenseByCat.get(categoryId) ?? 0);
      rows.push({
        categoryId,
        plannedCents,
        actualCents,
        remainingCents: plannedCents - actualCents,
        isIncome: category.isIncome,
      });
      // Rollups are expense-only; income is summed separately into incomeCents.
      if (!category.isIncome) {
        totalPlannedCents += plannedCents;
        totalActualCents += actualCents;
      }
    }

    // incomeCents is every income-type transaction in the month, independent of
    // any planned limits — the basis for "to be budgeted".
    const incomeCents = actuals
      .filter((a) => a.type === TransactionType.INCOME)
      .reduce((sum, a) => sum + a.totalCents, 0);

    return {
      month,
      categories: rows,
      totalPlannedCents,
      totalActualCents,
      incomeCents,
      toBeBudgetedCents: incomeCents - totalPlannedCents,
    };
  }

  /**
   * Upsert the planned limit for one category in a month's budget. Auto-creates
   * the Budget on first write. Rejects a categoryId that isn't in the caller's
   * household (the cross-household guard for the write side).
   */
  async setBudgetCategory(
    householdId: string,
    month: string,
    categoryId: string,
    plannedCents: number,
  ): Promise<void> {
    this.assertValidMonth(month);
    await this.assertCategoryInHousehold(householdId, categoryId);

    const budget = await this.getOrCreateBudget(householdId, month);
    await this.upsertBudgetCategory(budget._id, categoryId, plannedCents);
  }

  /**
   * Upsert several category limits in one call (the optional bulk endpoint).
   * Validates every categoryId against the household up front, so a foreign
   * category rejects the whole request before any write. The upserts are
   * independent and idempotent (keyed by the unique (budgetId, categoryId)), so
   * re-sending the same batch converges — there is no multi-document
   * transaction (consistent with the rest of the codebase). Returns the
   * recomputed budget-vs-actual view so the client gets the updated state in one
   * round-trip.
   */
  async bulkSetBudgetCategories(
    householdId: string,
    month: string,
    items: BulkBudgetCategoryLimitDto[],
  ): Promise<BudgetView> {
    this.assertValidMonth(month);
    await this.assertCategoriesInHousehold(
      householdId,
      items.map((i) => i.categoryId),
    );

    if (items.length > 0) {
      const budget = await this.getOrCreateBudget(householdId, month);
      // Cast as the codebase does for Mongoose filters (backend-patterns.md):
      // the schema's ObjectId field types don't line up with mongoose's own
      // ObjectId under strict tsc.
      const operations = items.map((item) => ({
        updateOne: {
          filter: {
            budgetId: budget._id,
            categoryId: new Types.ObjectId(item.categoryId),
          },
          update: {
            $set: { plannedCents: item.plannedCents },
            $setOnInsert: {
              budgetId: budget._id,
              categoryId: new Types.ObjectId(item.categoryId),
            },
          },
          upsert: true,
        },
      })) as unknown as AnyBulkWriteOperation<BudgetCategoryDocument>[];
      try {
        await this.budgetCategoryModel.bulkWrite(operations);
      } catch (error: unknown) {
        // No multi-doc transaction here, so a mid-batch failure can leave some
        // limits set and others not. The upserts are idempotent (a retry
        // converges), but log the partial state with full context so it's a
        // greppable event rather than a silent drift, then rethrow.
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          { householdId, month, attempted: operations.length },
          `Bulk budget upsert failed; some category limits may be partially ` +
            `applied: ${message}`,
        );
        throw error;
      }
    }

    return this.getBudgetVsActual(householdId, month);
  }

  /**
   * Clear a category's planned limit. Idempotent: a no-op (no Budget yet, or no
   * row for that category) is not an error. The category can still appear in the
   * budget view afterward — with plannedCents 0 — if it has spend this month.
   */
  async deleteBudgetCategory(
    householdId: string,
    month: string,
    categoryId: string,
  ): Promise<void> {
    this.assertValidMonth(month);
    // Don't auto-create a budget just to delete from it.
    const budget = await this.findBudget(householdId, month);
    if (!budget) {
      return;
    }
    await this.budgetCategoryModel
      .deleteOne({
        budgetId: budget._id,
        categoryId: new Types.ObjectId(categoryId),
      } as Record<string, unknown>)
      .exec();
  }

  // --- helpers -------------------------------------------------------------

  private assertValidMonth(month: string): void {
    if (!isValidMonth(month)) {
      throw new BadRequestException(
        `"${month}" is not a valid budget month (expected YYYY-MM)`,
      );
    }
  }

  private async assertCategoryInHousehold(
    householdId: string,
    categoryId: string,
  ): Promise<void> {
    const category = await this.categoriesService.findInHousehold(
      householdId,
      categoryId,
    );
    if (!category) {
      throw new BadRequestException(
        'categoryId does not reference a category in this household',
      );
    }
  }

  // Validate a batch of categoryIds with one query: any id not in the
  // household's category set fails the whole batch.
  private async assertCategoriesInHousehold(
    householdId: string,
    categoryIds: string[],
  ): Promise<void> {
    if (categoryIds.length === 0) {
      return;
    }
    const categories = await this.categoriesService.listCategories(
      householdId,
      true,
    );
    const valid = new Set(categories.map((c) => c._id.toString()));
    const foreign = categoryIds.find((id) => !valid.has(id));
    if (foreign) {
      throw new BadRequestException(
        'categoryId does not reference a category in this household',
      );
    }
  }

  private async findBudget(
    householdId: string,
    month: string,
  ): Promise<BudgetDocument | null> {
    return this.budgetModel
      .findOne({
        householdId: new Types.ObjectId(householdId),
        month,
      } as Record<string, unknown>)
      .exec();
  }

  // Auto-create (or fetch) the month's Budget. Mirrors the dup-key-safe upsert
  // idiom used for category seeding: a racing first-write loses the unique-index
  // race, after which the budget exists and is re-read.
  private async getOrCreateBudget(
    householdId: string,
    month: string,
  ): Promise<BudgetDocument> {
    const filter = {
      householdId: new Types.ObjectId(householdId),
      month,
    } as Record<string, unknown>;
    try {
      return await this.budgetModel
        .findOneAndUpdate(
          filter,
          {
            $setOnInsert: {
              householdId: new Types.ObjectId(householdId),
              month,
            },
          },
          { upsert: true, new: true },
        )
        .exec();
    } catch (error: unknown) {
      if (isDuplicateKeyError(error)) {
        const existing = await this.budgetModel.findOne(filter).exec();
        if (existing) {
          return existing;
        }
        // Lost the upsert race but the winner's insert isn't readable yet (read
        // concern / an interleaved delete). Log with context — unlike the
        // category seeder, this path has no per-household logging caller — then
        // surface the real cause instead of a misleading duplicate-key error.
        this.logger.error(
          { householdId, month },
          'Budget upsert lost a duplicate-key race but the existing budget ' +
            'could not be re-read',
        );
        throw new Error(
          `Budget upsert for "${month}" lost a duplicate-key race but the ` +
            'existing budget could not be re-read',
        );
      }
      throw error;
    }
  }

  private async upsertBudgetCategory(
    budgetId: Types.ObjectId,
    categoryId: string,
    plannedCents: number,
  ): Promise<void> {
    const categoryObjectId = new Types.ObjectId(categoryId);
    await this.budgetCategoryModel
      .updateOne(
        { budgetId, categoryId: categoryObjectId } as Record<string, unknown>,
        {
          $set: { plannedCents },
          $setOnInsert: { budgetId, categoryId: categoryObjectId },
        },
        { upsert: true },
      )
      .exec();
  }

  // The planned limits for a budget, keyed by category-id string. Empty when the
  // budget doesn't exist yet (the virtual GET path).
  private async loadPlannedByCategory(
    budget: BudgetDocument | null,
  ): Promise<Map<string, number>> {
    const planned = new Map<string, number>();
    if (!budget) {
      return planned;
    }
    const rows = await this.budgetCategoryModel
      .find({ budgetId: budget._id } as Record<string, unknown>)
      .exec();
    for (const row of rows) {
      planned.set(
        (row.categoryId as unknown as Types.ObjectId).toString(),
        row.plannedCents,
      );
    }
    return planned;
  }

  private sumByCategory(
    actuals: MonthlyCategoryActual[],
    type: TransactionType.INCOME | TransactionType.EXPENSE,
  ): Map<string, number> {
    const sums = new Map<string, number>();
    for (const actual of actuals) {
      if (actual.type === type) {
        sums.set(
          actual.categoryId,
          (sums.get(actual.categoryId) ?? 0) + actual.totalCents,
        );
      }
    }
    return sums;
  }
}
