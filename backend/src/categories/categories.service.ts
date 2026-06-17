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
   * Seed the default CategoryGroup/Category set for a household. Idempotent:
   * a household that already has at least one group is left untouched, so this
   * is safe to call from the household-creation path and re-run via the startup
   * backfill. Returns the number of categories created (0 when skipped).
   */
  async seedDefaultsForHousehold(householdId: string): Promise<number> {
    const householdObjectId = new Types.ObjectId(householdId);

    const existing = await this.groupModel
      .countDocuments({ householdId: householdObjectId } as Record<
        string,
        unknown
      >)
      .exec();
    if (existing > 0) {
      return 0;
    }

    let created = 0;
    for (let g = 0; g < DEFAULT_CATEGORY_GROUPS.length; g++) {
      const groupDef = DEFAULT_CATEGORY_GROUPS[g];
      const group = await new this.groupModel({
        householdId: householdObjectId,
        name: groupDef.name,
        sortOrder: g,
      }).save();

      for (let c = 0; c < groupDef.categories.length; c++) {
        const categoryDef = groupDef.categories[c];
        await new this.categoryModel({
          householdId: householdObjectId,
          groupId: group._id,
          name: categoryDef.name,
          isIncome: categoryDef.isIncome,
          sortOrder: c,
        }).save();
        created += 1;
      }
    }

    this.logger.log({ householdId }, `Seeded ${created} default categories`);
    return created;
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
   * Seed defaults into every household that has none yet. Idempotent repair for
   * households created before category seeding existed (or where the
   * best-effort seed at creation failed). Runs at startup after the Phase 1
   * household migration. Returns the number of households seeded.
   */
  async backfillDefaultCategories(): Promise<number> {
    const households = await this.householdModel.find().select('_id').exec();

    let seeded = 0;
    for (const household of households) {
      const created = await this.seedDefaultsForHousehold(
        household._id.toString(),
      );
      if (created > 0) {
        seeded += 1;
      }
    }

    if (seeded > 0) {
      this.logger.log(
        `Backfilled default categories for ${seeded} household(s)`,
      );
    }
    return seeded;
  }
}
