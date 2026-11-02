import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  LABEL_NAME_COLLATION,
  Label,
  LabelDocument,
} from './schemas/label.schema';
import {
  Transaction,
  TransactionDocument,
} from '../transactions/schemas/transaction.schema';
import {
  RecurringTransaction,
  RecurringTransactionDocument,
} from '../recurring/schemas/recurring-transaction.schema';
import { Goal, GoalDocument } from '../goals/schemas/goal.schema';
import { CreateLabelDto } from './dto/create-label.dto';
import { UpdateLabelDto } from './dto/update-label.dto';
import { RemoveLabelOutcomeDto } from './dto/remove-label-outcome.dto';
import { asConflictIfDuplicate } from '../common/mongo-errors';

const DUPLICATE_NAME_MESSAGE =
  'A label with this name already exists in this household (possibly archived)';

// Household label management (VEG-697). Mirrors CategoriesService: the unique
// index decides name collisions (no racy pre-check), DELETE archives instead
// when anything references the label, and findInHousehold is how the services
// that write labelId validate a client-supplied id.
@Injectable()
export class LabelsService {
  constructor(
    @InjectModel(Label.name)
    private readonly labelModel: Model<LabelDocument>,
    // Read-only here: consulted to decide archive-vs-hard-delete (a label any
    // ledger, recurring or goal record points at must survive as archived).
    @InjectModel(Transaction.name)
    private readonly transactionModel: Model<TransactionDocument>,
    @InjectModel(RecurringTransaction.name)
    private readonly recurringModel: Model<RecurringTransactionDocument>,
    @InjectModel(Goal.name) private readonly goalModel: Model<GoalDocument>,
  ) {}

  /**
   * List a household's labels (non-archived by default), ordered by name. The
   * sort uses the unique index's case-insensitive collation, so "apple" sorts
   * next to "Apple" and the index can serve the sort.
   */
  async list(
    householdId: string,
    includeArchived = false,
  ): Promise<LabelDocument[]> {
    const filter: Record<string, unknown> = {
      householdId: new Types.ObjectId(householdId),
    };
    if (!includeArchived) {
      filter.isArchived = false;
    }
    return this.labelModel
      .find(filter)
      .sort({ name: 1 })
      .collation(LABEL_NAME_COLLATION)
      .exec();
  }

  /** Create a label. A duplicate name (ignoring case) → 409. */
  async create(
    householdId: string,
    dto: CreateLabelDto,
  ): Promise<LabelDocument> {
    const householdObjectId = new Types.ObjectId(householdId);
    const parent = dto.parentId
      ? await this.assertParentUsable(householdObjectId, dto.parentId)
      : undefined;
    try {
      return await new this.labelModel({
        householdId: householdObjectId,
        name: dto.name,
        color: dto.color,
        parentId: parent?._id,
      }).save();
    } catch (error: unknown) {
      throw asConflictIfDuplicate(error, DUPLICATE_NAME_MESSAGE);
    }
  }

  /**
   * Partial update: rename, recolor, re-parent, archive or restore. Missing or
   * foreign label → 404 (indistinguishable, no existence leak). A new parent
   * must be in the household, active, and not the label itself or one of its
   * descendants. An unchanged parent is not re-validated, so a label already
   * under a since-archived parent stays editable. Name collision → 409.
   */
  async update(
    householdId: string,
    labelId: string,
    dto: UpdateLabelDto,
  ): Promise<LabelDocument> {
    const householdObjectId = new Types.ObjectId(householdId);
    const label = await this.findOwnedLabel(householdObjectId, labelId);

    if (dto.parentId === null) {
      label.parentId = undefined;
    } else if (dto.parentId !== undefined) {
      const currentParentId = (
        label.parentId as unknown as Types.ObjectId | undefined
      )?.toHexString();
      if (dto.parentId.toLowerCase() !== currentParentId) {
        if (dto.parentId.toLowerCase() === label._id.toHexString()) {
          throw new BadRequestException('A label cannot be its own parent');
        }
        const parent = await this.assertParentUsable(
          householdObjectId,
          dto.parentId,
        );
        await this.assertNotDescendant(householdObjectId, label, parent);
        label.parentId = parent._id as unknown as typeof label.parentId;
      }
    }
    if (dto.name !== undefined) {
      label.name = dto.name;
    }
    if (dto.color !== undefined) {
      label.color = dto.color;
    }
    if (dto.isArchived !== undefined) {
      label.isArchived = dto.isArchived;
    }
    try {
      return await label.save();
    } catch (error: unknown) {
      throw asConflictIfDuplicate(error, DUPLICATE_NAME_MESSAGE);
    }
  }

  /**
   * Delete a label, archiving instead when any transaction, recurring template
   * or goal references it, so those records keep a labelId that resolves. The
   * outcome tells the client which happened. Blocked (409) while another label
   * has it as parent, the way a non-empty category group is: re-parenting is
   * the client's move. The reference check and the delete are not atomic (no
   * multi-document transactions in this codebase), so a record labeled in the
   * window can end up with a dangling labelId.
   */
  async remove(
    householdId: string,
    labelId: string,
  ): Promise<RemoveLabelOutcomeDto> {
    const householdObjectId = new Types.ObjectId(householdId);
    const label = await this.findOwnedLabel(householdObjectId, labelId);

    const hasChild = await this.labelModel
      .exists({
        householdId: householdObjectId,
        parentId: label._id,
      } as Record<string, unknown>)
      .exec();
    if (hasChild) {
      throw new ConflictException('Re-parent or delete child labels first');
    }

    const referenceFilter = {
      householdId: householdObjectId,
      labelId: label._id,
    } as Record<string, unknown>;
    const [transactionRef, recurringRef, goalRef] = await Promise.all([
      this.transactionModel.exists(referenceFilter).exec(),
      this.recurringModel.exists(referenceFilter).exec(),
      this.goalModel.exists(referenceFilter).exec(),
    ]);

    if (transactionRef || recurringRef || goalRef) {
      if (!label.isArchived) {
        label.isArchived = true;
        await label.save();
      }
      return { outcome: 'archived' };
    }
    await label.deleteOne();
    return { outcome: 'deleted' };
  }

  /**
   * Look up a single label scoped to a household. Returns null if the id is
   * malformed, doesn't exist, or belongs to another household. Callers use
   * this to validate a client-supplied labelId before referencing it.
   */
  async findInHousehold(
    householdId: string,
    labelId: string,
  ): Promise<LabelDocument | null> {
    if (!Types.ObjectId.isValid(labelId)) {
      return null;
    }
    return this.labelModel
      .findOne({
        _id: new Types.ObjectId(labelId),
        householdId: new Types.ObjectId(householdId),
      } as Record<string, unknown>)
      .exec();
  }

  /**
   * The rule for writing a labelId onto a transaction, recurring template,
   * goal or subscription: the label must be in the caller's household and
   * active. Missing and foreign are indistinguishable (400, no existence
   * leak). Callers decide when to run it; they skip an unchanged label so a
   * record whose label was archived later stays editable.
   */
  async assertAssignable(householdId: string, labelId: string): Promise<void> {
    const label = await this.findInHousehold(householdId, labelId);
    if (!label) {
      throw new BadRequestException(
        'labelId does not reference a label in this household',
      );
    }
    if (label.isArchived) {
      throw new BadRequestException('Cannot assign an archived label');
    }
  }

  // Resolve a client-supplied parentId to an active label in the household, or
  // 400. Foreign and nonexistent are indistinguishable, no existence leak.
  private async assertParentUsable(
    householdObjectId: Types.ObjectId,
    parentId: string,
  ): Promise<LabelDocument> {
    const parent = await this.labelModel
      .findOne({
        _id: new Types.ObjectId(parentId),
        householdId: householdObjectId,
      } as Record<string, unknown>)
      .exec();
    if (!parent) {
      throw new BadRequestException(
        'parentId does not reference a label in this household',
      );
    }
    if (parent.isArchived) {
      throw new BadRequestException(
        'Cannot nest a label under an archived label',
      );
    }
    return parent;
  }

  // Walk parentId upward from the proposed parent. Reaching the label being
  // updated means the new parent is one of its descendants, and saving would
  // close a loop. The visited set ends the walk on a loop that already exists
  // elsewhere, so bad data cannot spin this forever.
  private async assertNotDescendant(
    householdObjectId: Types.ObjectId,
    label: LabelDocument,
    parent: LabelDocument,
  ): Promise<void> {
    const visited = new Set<string>([parent._id.toHexString()]);
    let cursor = parent.parentId as unknown as Types.ObjectId | undefined;
    while (cursor) {
      if (label._id.equals(cursor)) {
        throw new BadRequestException(
          'A label cannot be nested under its own descendant',
        );
      }
      const key = cursor.toHexString();
      if (visited.has(key)) {
        return;
      }
      visited.add(key);
      const ancestor = await this.labelModel
        .findOne({
          _id: cursor,
          householdId: householdObjectId,
        } as Record<string, unknown>)
        .exec();
      cursor = ancestor?.parentId as unknown as Types.ObjectId | undefined;
    }
  }

  // Household-scoped label lookup for the write paths → 404 when absent.
  private async findOwnedLabel(
    householdObjectId: Types.ObjectId,
    labelId: string,
  ): Promise<LabelDocument> {
    const label = await this.labelModel
      .findOne({
        _id: new Types.ObjectId(labelId),
        householdId: householdObjectId,
      } as Record<string, unknown>)
      .exec();
    if (!label) {
      throw new NotFoundException('Label not found');
    }
    return label;
  }
}
