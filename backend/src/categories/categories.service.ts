import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AnyBulkWriteOperation, Model, Types } from 'mongoose';
import {
  CategoryGroup,
  CategoryGroupDocument,
} from './schemas/category-group.schema';
import { Category, CategoryDocument } from './schemas/category.schema';
import {
  Household,
  HouseholdDocument,
} from '../households/schemas/household.schema';
import {
  Transaction,
  TransactionDocument,
} from '../transactions/schemas/transaction.schema';
import {
  BudgetCategory,
  BudgetCategoryDocument,
} from '../budgets/schemas/budget-category.schema';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CreateCategoryGroupDto } from './dto/create-category-group.dto';
import { UpdateCategoryGroupDto } from './dto/update-category-group.dto';
import { RemoveCategoryOutcomeDto } from './dto/remove-category-outcome.dto';
import { DEFAULT_CATEGORY_GROUPS } from './default-categories';

// MongoDB duplicate-key error code. A concurrent seed (two boots/replicas, or a
// household-creation seed racing the startup backfill) can lose the upsert race
// and surface this; the document it tried to insert already exists, which is the
// desired end state, so we treat it as a benign no-op.
const DUPLICATE_KEY = 11000;

function isDuplicateKeyError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as { code: number }).code === DUPLICATE_KEY
  );
}

@Injectable()
export class CategoriesService {
  private readonly logger = new Logger(CategoriesService.name);

  constructor(
    @InjectModel(CategoryGroup.name)
    private readonly groupModel: Model<CategoryGroupDocument>,
    @InjectModel(Category.name)
    private readonly categoryModel: Model<CategoryDocument>,
    @InjectModel(Household.name)
    private readonly householdModel: Model<HouseholdDocument>,
    // Read-only here: consulted to decide archive-vs-hard-delete (a category
    // referenced by ledger or budget data must survive as archived).
    @InjectModel(Transaction.name)
    private readonly transactionModel: Model<TransactionDocument>,
    @InjectModel(BudgetCategory.name)
    private readonly budgetCategoryModel: Model<BudgetCategoryDocument>,
  ) {}

  /**
   * Seed the default CategoryGroup/Category set for a household. Idempotent and
   * self-repairing: every group/category is upserted by its unique household key
   * ((householdId, name) and (householdId, groupId, name)), so re-running
   * converges to the full set regardless of where a prior attempt died — a
   * partially-seeded household is completed, not skipped. Concurrency-safe: a
   * racing seed that loses the upsert hits the unique index and is ignored
   * rather than creating duplicates. Returns the number of categories newly
   * created (0 when everything already existed).
   */
  async seedDefaultsForHousehold(householdId: string): Promise<number> {
    const householdObjectId = new Types.ObjectId(householdId);

    let created = 0;
    for (let g = 0; g < DEFAULT_CATEGORY_GROUPS.length; g++) {
      const groupDef = DEFAULT_CATEGORY_GROUPS[g];
      const group = await this.upsertGroup(householdObjectId, groupDef.name, g);

      for (let c = 0; c < groupDef.categories.length; c++) {
        const categoryDef = groupDef.categories[c];
        const inserted = await this.upsertCategory(
          householdObjectId,
          group._id,
          categoryDef.name,
          categoryDef.isIncome,
          c,
        );
        if (inserted) {
          created += 1;
        }
      }
    }

    // Stamp only after every upsert above succeeded: a crash mid-seed leaves
    // the household unstamped, so the next backfill still repairs it. Once
    // stamped, the backfill skips this household forever — user edits to the
    // defaults (rename, hard-delete) are never resurrected by the
    // upsert-by-name seeder.
    await this.householdModel
      .updateOne({ _id: householdObjectId } as Record<string, unknown>, {
        $set: { defaultCategoriesSeededAt: new Date() },
      })
      .exec();

    if (created > 0) {
      this.logger.log({ householdId }, `Seeded ${created} default categories`);
    }
    return created;
  }

  // Upsert a group by (householdId, name), returning the persisted document.
  // On a lost upsert race the unique index throws DUPLICATE_KEY; the group then
  // already exists, so re-read it.
  private async upsertGroup(
    householdId: Types.ObjectId,
    name: string,
    sortOrder: number,
  ): Promise<CategoryGroupDocument> {
    const filter = { householdId, name } as Record<string, unknown>;
    try {
      const group = await this.groupModel
        .findOneAndUpdate(
          filter,
          { $setOnInsert: { householdId, name, sortOrder } },
          { upsert: true, new: true },
        )
        .exec();
      return group;
    } catch (error: unknown) {
      if (isDuplicateKeyError(error)) {
        const existing = await this.groupModel.findOne(filter).exec();
        if (existing) {
          return existing;
        }
        // Lost the upsert race but the winner's insert isn't readable yet (read
        // concern / interleaved delete). Surface the real cause instead of the
        // misleading duplicate-key error; the caller's per-household catch logs
        // it with context and the next backfill retries.
        throw new Error(
          `Group upsert for "${name}" lost a duplicate-key race but the ` +
            'existing group could not be re-read',
        );
      }
      throw error;
    }
  }

  // Upsert a category by (householdId, groupId, name). Returns true if a new
  // category was inserted, false if it already existed (incl. a lost race that
  // surfaces DUPLICATE_KEY — the category exists, so it's a benign no-op).
  private async upsertCategory(
    householdId: Types.ObjectId,
    groupId: Types.ObjectId,
    name: string,
    isIncome: boolean,
    sortOrder: number,
  ): Promise<boolean> {
    const filter = { householdId, groupId, name } as Record<string, unknown>;
    try {
      const result = await this.categoryModel
        .updateOne(
          filter,
          {
            $setOnInsert: { householdId, groupId, name, isIncome, sortOrder },
          },
          { upsert: true },
        )
        .exec();
      return (result.upsertedCount ?? 0) > 0;
    } catch (error: unknown) {
      if (isDuplicateKeyError(error)) {
        return false;
      }
      throw error;
    }
  }

  /** List a household's category groups, ordered for display. */
  async listGroups(householdId: string): Promise<CategoryGroupDocument[]> {
    return this.groupModel
      .find({ householdId: new Types.ObjectId(householdId) } as Record<
        string,
        unknown
      >)
      .sort({ sortOrder: 1 })
      .exec();
  }

  /**
   * List a household's (non-archived by default) categories, ordered for
   * display. Transactions reference these by id.
   */
  async listCategories(
    householdId: string,
    includeArchived = false,
  ): Promise<CategoryDocument[]> {
    const filter: Record<string, unknown> = {
      householdId: new Types.ObjectId(householdId),
    };
    if (!includeArchived) {
      filter.isArchived = false;
    }
    return this.categoryModel.find(filter).sort({ sortOrder: 1 }).exec();
  }

  /**
   * Look up a single category scoped to a household. Returns null if the id is
   * malformed, doesn't exist, or belongs to another household — callers use
   * this to validate a client-supplied categoryId before referencing it (the
   * transaction ledger's cross-household guard).
   */
  async findInHousehold(
    householdId: string,
    categoryId: string,
  ): Promise<CategoryDocument | null> {
    if (!Types.ObjectId.isValid(categoryId)) {
      return null;
    }
    return this.categoryModel
      .findOne({
        _id: new Types.ObjectId(categoryId),
        householdId: new Types.ObjectId(householdId),
      } as Record<string, unknown>)
      .exec();
  }

  /**
   * Build the lookups the CSV importer needs for a household: a
   * lowercased-name → id map for matching a row's category column, plus a
   * fallback id (the seeded "Miscellaneous", else any expense category, else the
   * first category) used when a row has no match. `fallbackId` is null only when
   * the household has no categories at all (shouldn't happen post-seeding).
   */
  async resolveImportCategories(householdId: string): Promise<{
    byName: Map<string, Types.ObjectId>;
    fallbackId: Types.ObjectId | null;
  }> {
    const categories = await this.listCategories(householdId);
    const byName = new Map<string, Types.ObjectId>();
    for (const category of categories) {
      byName.set(category.name.trim().toLowerCase(), category._id);
    }
    const fallback =
      categories.find((c) => c.name.trim().toLowerCase() === 'miscellaneous') ??
      categories.find((c) => !c.isIncome) ??
      categories[0];
    return {
      byName,
      fallbackId: fallback ? fallback._id : null,
    };
  }

  /**
   * Seed defaults into every household, completing any that are missing or only
   * partially seeded (seedDefaultsForHousehold is itself idempotent/self-
   * repairing). Idempotent repair that runs at startup after the Phase 1
   * household migration. One household's failure is logged and skipped so it
   * can't starve the rest of the sweep. Returns the number of households that
   * received at least one new category.
   */
  async backfillDefaultCategories(): Promise<number> {
    // Only unstamped households: a stamp marks a fully-completed seed, after
    // which re-seeding would resurrect any default the household renamed or
    // deleted via the write API. Deliberate tradeoff: stamped households are
    // frozen at the default set they seeded with — a future addition to
    // DEFAULT_CATEGORY_GROUPS will NOT propagate to them and must ship with
    // its own migration (e.g. a seed-version field) rather than relying on
    // this backfill.
    const households = await this.householdModel
      .find({ defaultCategoriesSeededAt: { $exists: false } } as Record<
        string,
        unknown
      >)
      .select('_id')
      .exec();

    let seeded = 0;
    let failed = 0;
    for (const household of households) {
      const householdId = household._id.toString();
      try {
        const created = await this.seedDefaultsForHousehold(householdId);
        if (created > 0) {
          seeded += 1;
        }
      } catch (error: unknown) {
        failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          { householdId },
          `Default category backfill failed for household: ${message}`,
        );
      }
    }

    if (seeded > 0 || failed > 0) {
      this.logger.log(
        `Backfilled default categories: ${seeded} household(s) seeded, ${failed} failed`,
      );
    }
    return seeded;
  }

  // --- household category management (write side, VEG-437) ------------------

  /**
   * Create a category in one of the household's groups. sortOrder defaults to
   * the end of the target group. Duplicate (group, name) → 409 via the unique
   * index — no racy pre-check.
   */
  async createCategory(
    householdId: string,
    dto: CreateCategoryDto,
  ): Promise<CategoryDocument> {
    const householdObjectId = new Types.ObjectId(householdId);
    const groupObjectId = await this.assertGroupInHousehold(
      householdObjectId,
      dto.groupId,
    );
    const sortOrder =
      dto.sortOrder ??
      (await this.nextSortOrder(this.categoryModel, {
        householdId: householdObjectId,
        groupId: groupObjectId,
      }));
    try {
      return await new this.categoryModel({
        householdId: householdObjectId,
        groupId: groupObjectId,
        name: dto.name,
        isIncome: dto.isIncome ?? false,
        sortOrder,
      }).save();
    } catch (error: unknown) {
      throw this.asConflictIfDuplicate(
        error,
        'A category with this name already exists in this group (possibly archived)',
      );
    }
  }

  /**
   * Partial update: rename, move group, reorder, archive/un-archive. Foreign or
   * missing category → 404 (indistinguishable, no existence leak); foreign
   * target group → 400; name collision in the (new) group → 409.
   */
  async updateCategory(
    householdId: string,
    categoryId: string,
    dto: UpdateCategoryDto,
  ): Promise<CategoryDocument> {
    const householdObjectId = new Types.ObjectId(householdId);
    const category = await this.findOwnedCategory(
      householdObjectId,
      categoryId,
    );
    if (dto.groupId !== undefined) {
      const groupObjectId = await this.assertGroupInHousehold(
        householdObjectId,
        dto.groupId,
      );
      category.groupId = groupObjectId as unknown as typeof category.groupId;
    }
    if (dto.name !== undefined) {
      category.name = dto.name;
    }
    if (dto.sortOrder !== undefined) {
      category.sortOrder = dto.sortOrder;
    }
    if (dto.isArchived !== undefined) {
      category.isArchived = dto.isArchived;
    }
    try {
      return await category.save();
    } catch (error: unknown) {
      throw this.asConflictIfDuplicate(
        error,
        'A category with this name already exists in this group (possibly archived)',
      );
    }
  }

  /**
   * Delete a category, archiving instead when it is referenced by any
   * transaction or budget row (hard-deleting would orphan ledger history and
   * silently drop planned limits from the budget view). The outcome tells the
   * client which happened. Idempotent for already-archived categories. The
   * reference check and the delete are not atomic (no multi-doc transactions
   * in this codebase): a transaction created in the window can end up with a
   * dangling categoryId, which the budget view tolerates by dropping orphaned
   * actuals.
   */
  async removeCategory(
    householdId: string,
    categoryId: string,
  ): Promise<RemoveCategoryOutcomeDto> {
    const householdObjectId = new Types.ObjectId(householdId);
    const category = await this.findOwnedCategory(
      householdObjectId,
      categoryId,
    );

    // BudgetCategory carries no householdId; the globally-unique category id
    // makes the unscoped filter exact.
    const [transactionRef, budgetRef] = await Promise.all([
      this.transactionModel
        .exists({
          householdId: householdObjectId,
          categoryId: category._id,
        } as Record<string, unknown>)
        .exec(),
      this.budgetCategoryModel
        .exists({ categoryId: category._id } as Record<string, unknown>)
        .exec(),
    ]);

    if (transactionRef || budgetRef) {
      if (!category.isArchived) {
        category.isArchived = true;
        await category.save();
      }
      return { outcome: 'archived' };
    }
    await category.deleteOne();
    return { outcome: 'deleted' };
  }

  /**
   * Batch-set display order: each listed category gets sortOrder = its array
   * index. Partial lists are allowed (ordering is meaningful within a group, so
   * clients send one group's ids at a time); unlisted categories keep their
   * sortOrder. Any id outside the household fails the whole batch before any
   * write. No multi-document transaction (consistent with the codebase): the
   * writes are idempotent, so a retried batch converges; a mid-batch failure is
   * logged with context and rethrown. Returns the refreshed list.
   */
  async reorderCategories(
    householdId: string,
    categoryIds: string[],
  ): Promise<CategoryDocument[]> {
    const householdObjectId = new Types.ObjectId(householdId);
    // Ownership check by count: the DTO enforces unique ids, so every id is
    // household-owned (archived included) iff the scoped count matches. Avoids
    // hydrating every category document just to build an id set.
    const ownedCount = await this.categoryModel
      .countDocuments({
        householdId: householdObjectId,
        _id: { $in: categoryIds.map((id) => new Types.ObjectId(id)) },
      } as Record<string, unknown>)
      .exec();
    if (ownedCount !== categoryIds.length) {
      throw new BadRequestException(
        'categoryId does not reference a category in this household',
      );
    }

    const operations = categoryIds.map((id, index) => ({
      updateOne: {
        filter: {
          _id: new Types.ObjectId(id),
          householdId: householdObjectId,
        },
        update: { $set: { sortOrder: index } },
      },
    })) as unknown as AnyBulkWriteOperation<CategoryDocument>[];
    try {
      await this.categoryModel.bulkWrite(operations);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        { householdId, attempted: operations.length },
        `Category reorder bulk write failed; sort order may be partially ` +
          `applied: ${message}`,
      );
      throw error;
    }
    return this.listCategories(householdId, true);
  }

  /** Create a category group. Duplicate name in the household → 409. */
  async createGroup(
    householdId: string,
    dto: CreateCategoryGroupDto,
  ): Promise<CategoryGroupDocument> {
    const householdObjectId = new Types.ObjectId(householdId);
    const sortOrder =
      dto.sortOrder ??
      (await this.nextSortOrder(this.groupModel, {
        householdId: householdObjectId,
      }));
    try {
      return await new this.groupModel({
        householdId: householdObjectId,
        name: dto.name,
        sortOrder,
      }).save();
    } catch (error: unknown) {
      throw this.asConflictIfDuplicate(
        error,
        'A group with this name already exists in this household',
      );
    }
  }

  /** Rename and/or reorder a group. Missing/foreign → 404; name dup → 409. */
  async updateGroup(
    householdId: string,
    groupId: string,
    dto: UpdateCategoryGroupDto,
  ): Promise<CategoryGroupDocument> {
    const group = await this.findOwnedGroup(
      new Types.ObjectId(householdId),
      groupId,
    );
    if (dto.name !== undefined) {
      group.name = dto.name;
    }
    if (dto.sortOrder !== undefined) {
      group.sortOrder = dto.sortOrder;
    }
    try {
      return await group.save();
    } catch (error: unknown) {
      throw this.asConflictIfDuplicate(
        error,
        'A group with this name already exists in this household',
      );
    }
  }

  /**
   * Delete a group, blocked (409) while it still contains categories —
   * archived ones included, since they still reference the group. Reparenting
   * is the client's move: PATCH each category's groupId first.
   */
  async removeGroup(householdId: string, groupId: string): Promise<void> {
    const householdObjectId = new Types.ObjectId(householdId);
    const group = await this.findOwnedGroup(householdObjectId, groupId);
    const occupied = await this.categoryModel
      .exists({
        householdId: householdObjectId,
        groupId: group._id,
      } as Record<string, unknown>)
      .exec();
    if (occupied) {
      throw new ConflictException(
        'Group still contains categories; move or delete them first',
      );
    }
    await group.deleteOne();
  }

  // Resolve a client-supplied groupId to a group in the household, or 400.
  // Foreign and nonexistent are indistinguishable — no existence leak.
  private async assertGroupInHousehold(
    householdObjectId: Types.ObjectId,
    groupId: string,
  ): Promise<Types.ObjectId> {
    const groupObjectId = new Types.ObjectId(groupId);
    const group = await this.groupModel
      .findOne({
        _id: groupObjectId,
        householdId: householdObjectId,
      } as Record<string, unknown>)
      .exec();
    if (!group) {
      throw new BadRequestException(
        'groupId does not reference a group in this household',
      );
    }
    return groupObjectId;
  }

  // Household-scoped group lookup for the write paths → 404 when absent.
  private async findOwnedGroup(
    householdObjectId: Types.ObjectId,
    groupId: string,
  ): Promise<CategoryGroupDocument> {
    const group = await this.groupModel
      .findOne({
        _id: new Types.ObjectId(groupId),
        householdId: householdObjectId,
      } as Record<string, unknown>)
      .exec();
    if (!group) {
      throw new NotFoundException('Category group not found');
    }
    return group;
  }

  // Household-scoped category lookup for the write paths → 404 when absent.
  private async findOwnedCategory(
    householdObjectId: Types.ObjectId,
    categoryId: string,
  ): Promise<CategoryDocument> {
    const category = await this.categoryModel
      .findOne({
        _id: new Types.ObjectId(categoryId),
        householdId: householdObjectId,
      } as Record<string, unknown>)
      .exec();
    if (!category) {
      throw new NotFoundException('Category not found');
    }
    return category;
  }

  // Append-to-end default: one past the highest sortOrder matching the filter
  // (0 for the first document). Ties under concurrency are tolerated — display
  // order breaks them arbitrarily and reorder is the repair.
  private async nextSortOrder<T extends { sortOrder: number }>(
    model: Model<T>,
    filter: Record<string, unknown>,
  ): Promise<number> {
    const top = await model.findOne(filter).sort({ sortOrder: -1 }).exec();
    return top ? top.sortOrder + 1 : 0;
  }

  // Map a duplicate-name unique-index violation to a client-facing 409. Keyed
  // on the violated index actually covering `name` (when the driver reports
  // one), so a future non-name unique index isn't mislabeled as a name
  // conflict. Anything else is returned unchanged when it's an Error, else
  // wrapped in one. Returns rather than throws for `throw`-site clarity.
  private asConflictIfDuplicate(error: unknown, message: string): Error {
    if (isDuplicateKeyError(error)) {
      const keyPattern = (error as { keyPattern?: Record<string, unknown> })
        .keyPattern;
      if (!keyPattern || 'name' in keyPattern) {
        return new ConflictException(message);
      }
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}
