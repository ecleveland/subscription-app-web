import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  CategoryGroup,
  CategoryGroupDocument,
} from './schemas/category-group.schema';
import { Category, CategoryDocument } from './schemas/category.schema';
import {
  Household,
  HouseholdDocument,
} from '../households/schemas/household.schema';
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
   * Seed defaults into every household, completing any that are missing or only
   * partially seeded (seedDefaultsForHousehold is itself idempotent/self-
   * repairing). Idempotent repair that runs at startup after the Phase 1
   * household migration. One household's failure is logged and skipped so it
   * can't starve the rest of the sweep. Returns the number of households that
   * received at least one new category.
   */
  async backfillDefaultCategories(): Promise<number> {
    const households = await this.householdModel.find().select('_id').exec();

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
}
