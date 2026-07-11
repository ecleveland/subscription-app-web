import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  RecurringTransaction,
  RecurringTransactionDocument,
  RecurringType,
} from './schemas/recurring-transaction.schema';
import { CreateRecurringDto } from './dto/create-recurring.dto';
import { UpdateRecurringDto } from './dto/update-recurring.dto';
import { QueryRecurringDto } from './dto/query-recurring.dto';
import { AccountsService } from '../accounts/accounts.service';
import type { AccountDocument } from '../accounts/schemas/account.schema';
import { CategoriesService } from '../categories/categories.service';

// The merged, would-be-persisted state of a schedule's cross-field invariants,
// checked before any write so violations surface as 400s (the schema-level
// backstops would only fire at save time, as 500s).
interface ScheduleState {
  type: RecurringType;
  isSubscription: boolean;
  nextDate: Date;
  endDate?: Date;
}

// Household-scoped CRUD for recurring schedules (VEG-466). The materialization
// scheduler (VEG-467) and reminders (VEG-468) build on the model and the
// { isActive, nextDate } index; the subscriptions fold-in (VEG-469) reuses
// validateScheduleState for its non-DTO write path.
@Injectable()
export class RecurringService {
  private readonly logger = new Logger(RecurringService.name);

  constructor(
    @InjectModel(RecurringTransaction.name)
    private readonly recurringModel: Model<RecurringTransactionDocument>,
    private readonly accountsService: AccountsService,
    private readonly categoriesService: CategoriesService,
  ) {}

  async create(
    householdId: string,
    memberId: string,
    dto: CreateRecurringDto,
  ): Promise<RecurringTransactionDocument> {
    this.validateScheduleState({
      type: dto.type,
      isSubscription: dto.isSubscription ?? false,
      nextDate: new Date(dto.nextDate),
      endDate: dto.endDate ? new Date(dto.endDate) : undefined,
    });
    await Promise.all([
      this.assertAccountUsable(householdId, dto.accountId),
      this.assertCategoryUsable(householdId, dto.categoryId),
    ]);

    const created = await new this.recurringModel({
      householdId: new Types.ObjectId(householdId),
      accountId: new Types.ObjectId(dto.accountId),
      categoryId: new Types.ObjectId(dto.categoryId),
      memberId: memberId ? new Types.ObjectId(memberId) : undefined,
      type: dto.type,
      amountCents: dto.amountCents,
      payee: dto.payee,
      notes: dto.notes,
      tags: dto.tags ?? [],
      cadence: dto.cadence,
      nextDate: new Date(dto.nextDate),
      // Leave omitted fields undefined so the schema defaults apply.
      reminderDaysBefore: dto.reminderDaysBefore,
      endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      isActive: dto.isActive,
      isSubscription: dto.isSubscription,
      // Store null (the legacy "not shared" wire value) as unset.
      sharedWith: dto.sharedWith ?? undefined,
    }).save();

    this.logger.log(
      { householdId, recurringId: created._id.toString() },
      'Recurring schedule created',
    );
    return created;
  }

  async findAll(
    householdId: string,
    query: QueryRecurringDto,
  ): Promise<RecurringTransactionDocument[]> {
    const filter: Record<string, unknown> = {
      householdId: new Types.ObjectId(householdId),
    };
    if (query.type) {
      filter.type = query.type;
    }
    if (query.accountId) {
      filter.accountId = new Types.ObjectId(query.accountId);
    }
    if (query.categoryId) {
      filter.categoryId = new Types.ObjectId(query.categoryId);
    }
    if (query.isSubscription !== undefined) {
      filter.isSubscription = query.isSubscription;
    }
    if (query.isActive !== undefined) {
      filter.isActive = query.isActive;
    }
    // Upcoming-first; served by the { householdId, nextDate } index. No
    // pagination: a household's schedules are bounded by real-world bills,
    // the same cardinality as accounts/categories (which return arrays too).
    return this.recurringModel.find(filter).sort({ nextDate: 1 }).exec();
  }

  async findOne(
    householdId: string,
    id: string,
  ): Promise<RecurringTransactionDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`Recurring schedule "${id}" not found`);
    }
    const schedule = await this.recurringModel.findById(id).exec();
    if (
      !schedule ||
      !new Types.ObjectId(householdId).equals(
        schedule.householdId as unknown as Types.ObjectId,
      )
    ) {
      throw new NotFoundException(`Recurring schedule "${id}" not found`);
    }
    return schedule;
  }

  async update(
    householdId: string,
    id: string,
    dto: UpdateRecurringDto,
  ): Promise<RecurringTransactionDocument> {
    const existing = await this.findOne(householdId, id);

    this.validateScheduleState(
      {
        type: dto.type ?? existing.type,
        isSubscription: dto.isSubscription ?? existing.isSubscription,
        nextDate:
          dto.nextDate !== undefined
            ? new Date(dto.nextDate)
            : existing.nextDate,
        endDate:
          dto.endDate === undefined
            ? existing.endDate
            : dto.endDate === null
              ? undefined
              : new Date(dto.endDate),
      },
      // Only a patch that touches a date can create an impossible window; a
      // scheduler-completed doc (nextDate advanced past endDate, VEG-467)
      // must stay editable otherwise.
      { checkDates: dto.nextDate !== undefined || dto.endDate !== undefined },
    );

    // Re-validate a reference when it changes (re-pointing is held to the same
    // rules as a create) or when a paused schedule is being reactivated —
    // otherwise PATCH { isActive: true } would sneak new scheduler activity
    // onto an account/category archived while the schedule was paused.
    // Corrections to a schedule already sitting on an archived reference stay
    // allowed. Legacy docs (VEG-469) may have no accountId at all — optional
    // chaining keeps that safe.
    const existingAccountId = (
      existing.accountId as unknown as Types.ObjectId | undefined
    )?.toString();
    const existingCategoryId = (
      existing.categoryId as unknown as Types.ObjectId
    ).toString();
    const reactivating = dto.isActive === true && !existing.isActive;
    const checks: Promise<unknown>[] = [];
    if (dto.accountId !== undefined && dto.accountId !== existingAccountId) {
      checks.push(this.assertAccountUsable(householdId, dto.accountId));
    } else if (reactivating && existingAccountId) {
      checks.push(this.assertAccountUsable(householdId, existingAccountId));
    }
    if (dto.categoryId !== undefined && dto.categoryId !== existingCategoryId) {
      checks.push(this.assertCategoryUsable(householdId, dto.categoryId));
    } else if (reactivating) {
      checks.push(this.assertCategoryUsable(householdId, existingCategoryId));
    }
    await Promise.all(checks);

    if (dto.accountId !== undefined) {
      existing.accountId = new Types.ObjectId(
        dto.accountId,
      ) as unknown as typeof existing.accountId;
    }
    if (dto.categoryId !== undefined) {
      existing.categoryId = new Types.ObjectId(
        dto.categoryId,
      ) as unknown as typeof existing.categoryId;
    }
    if (dto.type !== undefined) existing.type = dto.type;
    if (dto.amountCents !== undefined) existing.amountCents = dto.amountCents;
    if (dto.payee !== undefined) existing.payee = dto.payee;
    if (dto.notes !== undefined) existing.notes = dto.notes;
    if (dto.tags !== undefined) existing.tags = dto.tags;
    if (dto.cadence !== undefined) existing.cadence = dto.cadence;
    if (dto.nextDate !== undefined) existing.nextDate = new Date(dto.nextDate);
    if (dto.reminderDaysBefore !== undefined) {
      existing.reminderDaysBefore = dto.reminderDaysBefore;
    }
    if (dto.endDate !== undefined) {
      existing.endDate =
        dto.endDate === null ? undefined : new Date(dto.endDate);
    }
    if (dto.isActive !== undefined) existing.isActive = dto.isActive;
    if (dto.isSubscription !== undefined) {
      existing.isSubscription = dto.isSubscription;
    }
    if (dto.sharedWith !== undefined) {
      // Null-to-clear: store as unset rather than a persisted null.
      existing.sharedWith = dto.sharedWith ?? undefined;
    }

    // Save via the document, never findOneAndUpdate: the schema's
    // isSubscription cross-field validator only runs on the save path.
    const saved = await existing.save();
    this.logger.log(
      { householdId, recurringId: id },
      'Recurring schedule updated',
    );
    return saved;
  }

  async remove(householdId: string, id: string): Promise<void> {
    const existing = await this.findOne(householdId, id);
    // Materialized Transactions keep their recurringId — deleting the
    // schedule never touches the ledger.
    await this.recurringModel
      .deleteOne({ _id: existing._id } as Record<string, unknown>)
      .exec();
    this.logger.log(
      { householdId, recurringId: id },
      'Recurring schedule deleted',
    );
  }

  // --- helpers -------------------------------------------------------------

  // Cross-field invariants on the merged (would-be-persisted) state. The
  // date-pair check is skippable because an already-expired schedule is a
  // legitimate stored state; the subscription invariant never is.
  private validateScheduleState(
    state: ScheduleState,
    { checkDates = true }: { checkDates?: boolean } = {},
  ): void {
    // @IsDateString (isISO8601) admits formats JS Date cannot parse (week
    // dates like 2026-W32, ordinal 2026-213); reject them here so they fail
    // as 400s instead of Invalid Date blowing up inside Mongoose at save.
    if (Number.isNaN(state.nextDate.getTime())) {
      throw new BadRequestException('nextDate must be a parseable date');
    }
    if (state.endDate && Number.isNaN(state.endDate.getTime())) {
      throw new BadRequestException('endDate must be a parseable date');
    }
    if (state.isSubscription && state.type !== RecurringType.EXPENSE) {
      throw new BadRequestException('isSubscription requires type: expense');
    }
    if (
      checkDates &&
      state.endDate &&
      state.endDate.getTime() < state.nextDate.getTime()
    ) {
      throw new BadRequestException('endDate must be on or after nextDate');
    }
  }

  // Assert the account exists in this household and can take new activity.
  // Cross-household/missing references are a client error (400), not a 404 —
  // the schedule is what's being created/updated.
  private async assertAccountUsable(
    householdId: string,
    accountId: string,
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
        'Cannot point a recurring schedule at an archived account',
      );
    }
    return account;
  }

  private async assertCategoryUsable(
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
        'Cannot point a recurring schedule at an archived category',
      );
    }
  }
}
