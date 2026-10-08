import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Goal, GoalDocument } from './schemas/goal.schema';
import { CreateGoalDto } from './dto/create-goal.dto';
import { UpdateGoalDto } from './dto/update-goal.dto';
import { CategoriesService } from '../categories/categories.service';
import { parseUtcDate } from '../common/utc-date.util';

@Injectable()
export class GoalsService {
  private readonly logger = new Logger(GoalsService.name);

  constructor(
    @InjectModel(Goal.name)
    private readonly goalModel: Model<GoalDocument>,
    private readonly categoriesService: CategoriesService,
  ) {}

  /** Create a goal. currentCents always starts at 0, whatever the body says. */
  async create(householdId: string, dto: CreateGoalDto): Promise<GoalDocument> {
    if (dto.categoryId) {
      await this.assertCategoryInHousehold(householdId, dto.categoryId);
    }
    const goal = new this.goalModel({
      householdId: new Types.ObjectId(householdId),
      name: dto.name,
      type: dto.type,
      targetCents: dto.targetCents,
      currentCents: 0,
      isArchived: false,
      ...(dto.targetDate && { targetDate: parseUtcDate(dto.targetDate) }),
      ...(dto.categoryId && {
        categoryId: new Types.ObjectId(dto.categoryId),
      }),
    });
    const saved = await goal.save();
    this.logger.log(
      { householdId, goalId: saved._id.toString() },
      'Goal created',
    );
    return saved;
  }

  /** List a household's goals, newest first. Archived goals are opt-in. */
  async findAll(
    householdId: string,
    includeArchived = false,
  ): Promise<GoalDocument[]> {
    const filter: Record<string, unknown> = {
      householdId: new Types.ObjectId(householdId),
    };
    if (!includeArchived) {
      filter.isArchived = false;
    }
    // _id breaks ties between goals created in the same millisecond.
    return this.goalModel.find(filter).sort({ createdAt: -1, _id: -1 }).exec();
  }

  /** Get one goal. Another household's goal is a 404, same as a missing one. */
  async findOne(householdId: string, id: string): Promise<GoalDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw this.notFound(id);
    }
    const goal = await this.goalModel.findById(id).exec();
    if (
      !goal ||
      !new Types.ObjectId(householdId).equals(
        goal.householdId as unknown as Types.ObjectId,
      )
    ) {
      throw this.notFound(id);
    }
    return goal;
  }

  /**
   * Update the editable fields. Reads an explicit allowlist from the DTO so
   * currentCents can never be written here, even if it slips past validation.
   * null clears targetDate and categoryId.
   */
  async update(
    householdId: string,
    id: string,
    dto: UpdateGoalDto,
  ): Promise<GoalDocument> {
    const goal = await this.findOne(householdId, id);

    if (dto.categoryId) {
      await this.assertCategoryInHousehold(householdId, dto.categoryId);
    }

    if (dto.name !== undefined) goal.name = dto.name;
    if (dto.type !== undefined) goal.type = dto.type;
    if (dto.targetCents !== undefined) goal.targetCents = dto.targetCents;
    if (dto.isArchived !== undefined) goal.isArchived = dto.isArchived;
    if (dto.targetDate !== undefined) {
      goal.set(
        'targetDate',
        dto.targetDate === null ? undefined : parseUtcDate(dto.targetDate),
      );
    }
    if (dto.categoryId !== undefined) {
      goal.set(
        'categoryId',
        dto.categoryId === null
          ? undefined
          : new Types.ObjectId(dto.categoryId),
      );
    }

    const saved = await goal.save();
    this.logger.log({ householdId, goalId: id }, 'Goal updated');
    return saved;
  }

  /**
   * Add amountCents (negative for a correction) to currentCents as a single
   * atomic $inc. The household is part of the filter, so a goal in another
   * household matches nothing and surfaces as a 404.
   */
  async addContribution(
    householdId: string,
    id: string,
    amountCents: number,
  ): Promise<GoalDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw this.notFound(id);
    }
    const goal = await this.goalModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          householdId: new Types.ObjectId(householdId),
        } as Record<string, unknown>,
        { $inc: { currentCents: amountCents } },
        { new: true },
      )
      .exec();
    if (!goal) {
      throw this.notFound(id);
    }
    this.logger.log(
      { householdId, goalId: id, amountCents },
      'Goal contribution applied',
    );
    return goal;
  }

  /** Hard-delete a goal. Nothing else references goals, so no soft delete. */
  async remove(householdId: string, id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) {
      throw this.notFound(id);
    }
    const result = await this.goalModel
      .deleteOne({
        _id: new Types.ObjectId(id),
        householdId: new Types.ObjectId(householdId),
      } as Record<string, unknown>)
      .exec();
    if (result.deletedCount === 0) {
      throw this.notFound(id);
    }
    this.logger.log({ householdId, goalId: id }, 'Goal deleted');
  }

  private notFound(id: string): NotFoundException {
    return new NotFoundException(`Goal with ID "${id}" not found`);
  }

  // Mirrors BudgetsService.assertCategoryInHousehold: a foreign category gets
  // the same 400 message, and an archived one is rejected because it is hidden
  // from the category picker.
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
    if (category.isArchived) {
      throw new BadRequestException(
        'Cannot link a goal to an archived category',
      );
    }
  }
}
