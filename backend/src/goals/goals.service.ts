import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Goal, GoalDocument, GoalType } from './schemas/goal.schema';
import { CreateGoalDto } from './dto/create-goal.dto';
import { UpdateGoalDto } from './dto/update-goal.dto';
import { CategoriesService } from '../categories/categories.service';
import { AccountsService } from '../accounts/accounts.service';
import {
  AccountDocument,
  AccountType,
} from '../accounts/schemas/account.schema';
import { parseUtcDate } from '../common/utc-date.util';

/** The account a goal tracks, as the API returns it. */
export interface LinkedAccount {
  accountId: string;
  name: string;
}

/**
 * What every goals endpoint returns: the stored goal with currentCents
 * resolved (derived from the account while linked) and the linked account's
 * name. baselineCents is internal and never part of it.
 */
export interface GoalView extends Omit<Goal, 'baselineCents'> {
  _id: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
  linkedAccount: LinkedAccount | null;
}

// Which accounts can back each goal type. Asset balances are positive and grow
// as you save. Credit and loan balances are negative and rise toward 0 as you
// pay down, so balanceCents - baselineCents counts up for both goal types.
// Same split as ASSET_TYPES and LIABILITY_TYPES in reports.service.ts.
const LINKABLE_ACCOUNT_TYPES: Record<GoalType, ReadonlySet<AccountType>> = {
  [GoalType.SAVINGS]: new Set([
    AccountType.CHECKING,
    AccountType.SAVINGS,
    AccountType.CASH,
    AccountType.INVESTMENT,
  ]),
  [GoalType.DEBT]: new Set([AccountType.CREDIT, AccountType.LOAN]),
};

const PAIRING_ERRORS: Record<GoalType, string> = {
  [GoalType.SAVINGS]: 'A savings goal can only track an asset account',
  [GoalType.DEBT]: 'A debt goal can only track a credit or loan account',
};

// Field writes as an update document. update() applies them through save, or
// through findOneAndUpdate when unlinking.
interface GoalWrites {
  $set: Record<string, unknown>;
  $unset: Record<string, 1>;
}

// The linked account id as a lowercase hex string, or undefined when unlinked.
function linkedAccountId(goal: GoalDocument): string | undefined {
  return goal.accountId
    ? (goal.accountId as unknown as Types.ObjectId).toHexString()
    : undefined;
}

@Injectable()
export class GoalsService {
  private readonly logger = new Logger(GoalsService.name);

  constructor(
    @InjectModel(Goal.name)
    private readonly goalModel: Model<GoalDocument>,
    private readonly categoriesService: CategoriesService,
    private readonly accountsService: AccountsService,
  ) {}

  /**
   * Create a goal. currentCents always starts at 0, whatever the body says.
   * With an accountId the goal baselines at the account's current balance, so
   * its progress also starts at 0.
   */
  async create(householdId: string, dto: CreateGoalDto): Promise<GoalView> {
    if (dto.categoryId) {
      await this.assertCategoryInHousehold(householdId, dto.categoryId);
    }
    const account = dto.accountId
      ? await this.assertAccountLinkable(householdId, dto.accountId, dto.type)
      : undefined;
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
      ...(account && {
        accountId: account._id,
        baselineCents: account.balanceCents,
      }),
    });
    const saved = await goal.save();
    this.logger.log(
      { householdId, goalId: saved._id.toString() },
      'Goal created',
    );
    return this.toView(saved, account);
  }

  /** List a household's goals, newest first. Archived goals are opt-in. */
  async findAll(
    householdId: string,
    includeArchived = false,
  ): Promise<GoalView[]> {
    const filter: Record<string, unknown> = {
      householdId: new Types.ObjectId(householdId),
    };
    if (!includeArchived) {
      filter.isArchived = false;
    }
    // _id breaks ties between goals created in the same millisecond.
    const goals = await this.goalModel
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .exec();
    if (!goals.some((goal) => goal.accountId)) {
      return goals.map((goal) => this.toView(goal));
    }

    // One query for every linked goal. Archived accounts are included because
    // a goal keeps tracking an account that was archived after linking.
    const accounts = await this.accountsService.findAll(householdId, true);
    const byId = new Map(
      accounts.map((account) => [account._id.toString(), account]),
    );
    return goals.map((goal) => {
      const accountId = linkedAccountId(goal);
      if (!accountId) {
        return this.toView(goal);
      }
      const account = byId.get(accountId);
      if (!account) {
        this.warnMissingAccount(householdId, goal);
      }
      return this.toView(goal, account);
    });
  }

  /** Get one goal. Another household's goal is a 404, same as a missing one. */
  async findOne(householdId: string, id: string): Promise<GoalView> {
    const goal = await this.findDoc(householdId, id);
    return this.toView(goal, await this.findLinkedAccount(householdId, goal));
  }

  /**
   * Update the editable fields. Reads an explicit allowlist from the DTO so
   * currentCents can never be written here, even if it slips past validation.
   * null clears targetDate and categoryId.
   *
   * accountId links, relinks or (with null) unlinks, each as one atomic
   * write. Linking sets the baseline so the progress shown does not move.
   * Unlinking freezes the derived progress into currentCents. Resending the
   * current accountId changes nothing.
   */
  async update(
    householdId: string,
    id: string,
    dto: UpdateGoalDto,
  ): Promise<GoalView> {
    const goal = await this.findDoc(householdId, id);

    if (dto.categoryId) {
      await this.assertCategoryInHousehold(householdId, dto.categoryId);
    }

    const writes = this.fieldWrites(dto);
    const linkedId = linkedAccountId(goal);
    const nextType = dto.type ?? goal.type;
    let account: AccountDocument | undefined;

    if (dto.accountId === null) {
      if (linkedId) {
        return this.unlink(householdId, goal, writes);
      }
    } else if (
      dto.accountId !== undefined &&
      dto.accountId.toLowerCase() !== linkedId
    ) {
      return this.link(
        householdId,
        goal,
        await this.assertAccountLinkable(householdId, dto.accountId, nextType),
        writes,
      );
    } else if (linkedId) {
      account = await this.findLinkedAccount(householdId, goal);
      if (account && dto.type !== undefined && dto.type !== goal.type) {
        this.assertPairing(account, dto.type);
      }
    }

    this.applyWrites(goal, writes);
    const saved = await goal.save();
    this.logger.log({ householdId, goalId: id }, 'Goal updated');
    return this.toView(saved, account);
  }

  /**
   * Add amountCents (negative for a correction) to currentCents as a single
   * atomic $inc. The household is part of the filter, so a goal in another
   * household matches nothing and surfaces as a 404. So does a linked goal,
   * which is then reported as a 400, because its progress follows the account.
   */
  async addContribution(
    householdId: string,
    id: string,
    amountCents: number,
  ): Promise<GoalView> {
    if (!Types.ObjectId.isValid(id)) {
      throw this.notFound(id);
    }
    const increment = () =>
      this.goalModel
        .findOneAndUpdate(
          {
            _id: new Types.ObjectId(id),
            householdId: new Types.ObjectId(householdId),
            accountId: { $exists: false },
          } as Record<string, unknown>,
          { $inc: { currentCents: amountCents } },
          { new: true },
        )
        .exec();

    let goal = await increment();
    if (!goal) {
      const existing = await this.findDoc(householdId, id);
      if (existing.accountId) {
        throw new BadRequestException(
          'Contributions are disabled while a goal tracks an account',
        );
      }
      // Unlinked between the two reads, so the $inc can match now.
      goal = await increment();
      if (!goal) {
        throw this.notFound(id);
      }
    }
    this.logger.log(
      { householdId, goalId: id, amountCents },
      'Goal contribution applied',
    );
    return this.toView(goal);
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

  // The hydrated document, for mutations. Public reads go through findOne,
  // which returns a view.
  private async findDoc(
    householdId: string,
    id: string,
  ): Promise<GoalDocument> {
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

  // Link or relink as one atomic write. The baseline is computed from the
  // currentCents just read, so the filter pins that value and the old link. A
  // contribution or another link change in between makes it match nothing,
  // which is a 409 rather than a baseline that silently drops the change.
  private async link(
    householdId: string,
    goal: GoalDocument,
    account: AccountDocument,
    writes: GoalWrites,
  ): Promise<GoalView> {
    const linkedId = linkedAccountId(goal);
    let currentCents = goal.currentCents;
    if (linkedId) {
      // Relink freezes the old account's progress before re-baselining.
      currentCents = this.derivedCents(
        goal,
        await this.findLinkedAccount(householdId, goal),
      );
      writes.$set.currentCents = currentCents;
    }
    const linked = await this.goalModel
      .findOneAndUpdate(
        {
          _id: goal._id,
          householdId: new Types.ObjectId(householdId),
          currentCents: goal.currentCents,
          accountId: linkedId
            ? new Types.ObjectId(linkedId)
            : { $exists: false },
        } as Record<string, unknown>,
        {
          $set: {
            accountId: account._id,
            baselineCents: account.balanceCents - currentCents,
            ...writes.$set,
          },
          $unset: writes.$unset,
        },
        { new: true, runValidators: true },
      )
      .exec();
    if (!linked) {
      throw new ConflictException(
        'Goal was modified concurrently; retry the request',
      );
    }
    this.logger.log(
      { householdId, goalId: goal._id.toString() },
      'Goal linked to account',
    );
    return this.toView(linked, account);
  }

  // Unlink as one atomic write, filtered on the link still being there, so a
  // concurrent unlink cannot freeze a stale value over the first one's result.
  private async unlink(
    householdId: string,
    goal: GoalDocument,
    writes: GoalWrites,
  ): Promise<GoalView> {
    const account = await this.findLinkedAccount(householdId, goal);
    const id = goal._id.toString();
    const unlinked = await this.goalModel
      .findOneAndUpdate(
        {
          _id: goal._id,
          householdId: new Types.ObjectId(householdId),
          accountId: { $exists: true },
        } as Record<string, unknown>,
        {
          $set: {
            currentCents: this.derivedCents(goal, account),
            ...writes.$set,
          },
          $unset: { accountId: 1, baselineCents: 1, ...writes.$unset },
        },
        { new: true, runValidators: true },
      )
      .exec();
    if (unlinked) {
      this.logger.log({ householdId, goalId: id }, 'Goal unlinked');
      return this.toView(unlinked);
    }

    // Another request unlinked it first. Its frozen value stands. Apply the
    // remaining edits to whatever is there now.
    const current = await this.findDoc(householdId, id);
    this.applyWrites(current, writes);
    const saved = await current.save();
    this.logger.log({ householdId, goalId: id }, 'Goal updated');
    return this.toView(saved, await this.findLinkedAccount(householdId, saved));
  }

  // The non-link edits from the allowlist. null clears targetDate and
  // categoryId.
  private fieldWrites(dto: UpdateGoalDto): GoalWrites {
    const writes: GoalWrites = { $set: {}, $unset: {} };
    if (dto.name !== undefined) writes.$set.name = dto.name;
    if (dto.type !== undefined) writes.$set.type = dto.type;
    if (dto.targetCents !== undefined) {
      writes.$set.targetCents = dto.targetCents;
    }
    if (dto.isArchived !== undefined) writes.$set.isArchived = dto.isArchived;
    if (dto.targetDate === null) {
      writes.$unset.targetDate = 1;
    } else if (dto.targetDate !== undefined) {
      writes.$set.targetDate = parseUtcDate(dto.targetDate);
    }
    if (dto.categoryId === null) {
      writes.$unset.categoryId = 1;
    } else if (dto.categoryId !== undefined) {
      writes.$set.categoryId = new Types.ObjectId(dto.categoryId);
    }
    return writes;
  }

  private applyWrites(goal: GoalDocument, writes: GoalWrites): void {
    for (const [field, value] of Object.entries(writes.$set)) {
      goal.set(field, value);
    }
    for (const field of Object.keys(writes.$unset)) {
      goal.set(field, undefined);
    }
  }

  // A plain copy for the response. The derived value never touches the
  // document, so a later save cannot persist it by accident.
  //
  // A linked goal whose account is missing keeps showing the link, under a
  // placeholder name, with its stored currentCents. Dropping the link would
  // offer a contribution form that always 400s and no way to unlink.
  private toView(goal: GoalDocument, account?: AccountDocument): GoalView {
    const plain = goal.toObject<GoalView & { baselineCents?: number }>();
    delete plain.baselineCents;
    const accountId = linkedAccountId(goal);
    if (!accountId) {
      return { ...plain, linkedAccount: null };
    }
    if (!account) {
      return {
        ...plain,
        linkedAccount: { accountId, name: 'Unavailable account' },
      };
    }
    return {
      ...plain,
      currentCents: this.derivedCents(goal, account),
      linkedAccount: { accountId: account._id.toString(), name: account.name },
    };
  }

  // Falls back to the stored value when the account is missing.
  private derivedCents(goal: GoalDocument, account?: AccountDocument): number {
    if (!account) {
      return goal.currentCents;
    }
    return account.balanceCents - (goal.baselineCents ?? 0);
  }

  // The linked account, or undefined when the goal is unlinked. A linked
  // account should never be missing, because accounts are archived rather
  // than deleted. If it is, the goal falls back to its stored currentCents.
  private async findLinkedAccount(
    householdId: string,
    goal: GoalDocument,
  ): Promise<AccountDocument | undefined> {
    const accountId = linkedAccountId(goal);
    if (!accountId) {
      return undefined;
    }
    try {
      return await this.accountsService.findOne(householdId, accountId);
    } catch (error) {
      if (error instanceof NotFoundException) {
        this.warnMissingAccount(householdId, goal);
        return undefined;
      }
      throw error;
    }
  }

  private warnMissingAccount(householdId: string, goal: GoalDocument): void {
    this.logger.warn(
      {
        householdId,
        goalId: goal._id.toString(),
        accountId: linkedAccountId(goal),
      },
      'Linked account not found, using stored currentCents',
    );
  }

  private notFound(id: string): NotFoundException {
    return new NotFoundException(`Goal with ID "${id}" not found`);
  }

  // Mirrors SubscriptionsService.assertAccountUsable: a missing or foreign
  // account is a 400, not a 404, because the goal is what the request writes.
  // The account must also be active and match the goal type.
  private async assertAccountLinkable(
    householdId: string,
    accountId: string,
    goalType: GoalType,
  ): Promise<AccountDocument> {
    let account: AccountDocument;
    try {
      account = await this.accountsService.findOne(householdId, accountId);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw new BadRequestException(
          `accountId "${accountId}" does not reference an account in this household`,
        );
      }
      throw error;
    }
    if (account.isArchived) {
      throw new BadRequestException(
        'Cannot link a goal to an archived account',
      );
    }
    this.assertPairing(account, goalType);
    return account;
  }

  private assertPairing(account: AccountDocument, goalType: GoalType): void {
    if (!LINKABLE_ACCOUNT_TYPES[goalType].has(account.type)) {
      throw new BadRequestException(PAIRING_ERRORS[goalType]);
    }
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
