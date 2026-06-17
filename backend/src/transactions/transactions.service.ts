import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Transaction,
  TransactionDocument,
  TransactionType,
} from './schemas/transaction.schema';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { QueryTransactionDto } from './dto/query-transaction.dto';
import { AccountsService } from '../accounts/accounts.service';
import type { AccountDocument } from '../accounts/schemas/account.schema';
import { CategoriesService } from '../categories/categories.service';

// The normalized, validated reference/effect shape of a transaction, derived
// from a create DTO or an existing doc merged with a patch. `categoryId` is set
// only for income/expense; `transferAccountId` only for transfers.
interface ResolvedTransaction {
  type: TransactionType;
  accountId: string;
  amountCents: number;
  categoryId?: string;
  transferAccountId?: string;
}

interface BalanceDelta {
  accountId: string;
  deltaCents: number;
}

export interface PaginatedTransactions {
  data: TransactionDocument[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
  };
}

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(
    @InjectModel(Transaction.name)
    private readonly transactionModel: Model<TransactionDocument>,
    private readonly accountsService: AccountsService,
    private readonly categoriesService: CategoriesService,
  ) {}

  async create(
    householdId: string,
    memberId: string,
    dto: CreateTransactionDto,
  ): Promise<TransactionDocument> {
    const resolved = this.normalize({
      type: dto.type,
      accountId: dto.accountId,
      amountCents: dto.amountCents,
      categoryId: dto.categoryId,
      transferAccountId: dto.transferAccountId,
    });
    await this.validateReferences(householdId, resolved, true);

    const created = await new this.transactionModel({
      householdId: new Types.ObjectId(householdId),
      accountId: new Types.ObjectId(resolved.accountId),
      categoryId: resolved.categoryId
        ? new Types.ObjectId(resolved.categoryId)
        : undefined,
      transferAccountId: resolved.transferAccountId
        ? new Types.ObjectId(resolved.transferAccountId)
        : undefined,
      memberId: memberId ? new Types.ObjectId(memberId) : undefined,
      type: resolved.type,
      amountCents: resolved.amountCents,
      date: dto.date,
      payee: dto.payee,
      notes: dto.notes,
      tags: dto.tags ?? [],
      cleared: dto.cleared ?? false,
    }).save();

    await this.syncBalances(
      householdId,
      [],
      this.balanceDeltas(resolved),
      created._id.toString(),
    );
    this.logger.log(
      { householdId, transactionId: created._id.toString() },
      'Transaction created',
    );
    return created;
  }

  async findAll(
    householdId: string,
    query: QueryTransactionDto,
  ): Promise<PaginatedTransactions> {
    const filter: Record<string, unknown> = {
      householdId: new Types.ObjectId(householdId),
    };
    if (query.accountId) {
      filter.accountId = new Types.ObjectId(query.accountId);
    }
    if (query.categoryId) {
      filter.categoryId = new Types.ObjectId(query.categoryId);
    }
    if (query.type) {
      filter.type = query.type;
    }
    if (query.cleared !== undefined) {
      filter.cleared = query.cleared;
    }
    if (query.dateFrom || query.dateTo) {
      const range: Record<string, Date> = {};
      if (query.dateFrom) range.$gte = new Date(query.dateFrom);
      if (query.dateTo) range.$lte = new Date(query.dateTo);
      filter.date = range;
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = limit === 0 ? 0 : (page - 1) * limit;

    const total = await this.transactionModel.countDocuments(filter).exec();
    const q = this.transactionModel.find(filter).sort({ date: -1 });
    if (limit !== 0) {
      q.skip(skip).limit(limit);
    }
    const data = await q.exec();

    const totalPages = limit === 0 ? 1 : Math.ceil(total / limit);
    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: limit === 0 ? false : page < totalPages,
      },
    };
  }

  async findOne(householdId: string, id: string): Promise<TransactionDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`Transaction with ID "${id}" not found`);
    }
    const transaction = await this.transactionModel.findById(id).exec();
    if (
      !transaction ||
      !new Types.ObjectId(householdId).equals(
        transaction.householdId as unknown as Types.ObjectId,
      )
    ) {
      throw new NotFoundException(`Transaction with ID "${id}" not found`);
    }
    return transaction;
  }

  async update(
    householdId: string,
    id: string,
    dto: UpdateTransactionDto,
  ): Promise<TransactionDocument> {
    const existing = await this.findOne(householdId, id);
    const before = this.fromDocument(existing);

    // Merge the patch onto the current state, then normalize so a type switch
    // drops the now-irrelevant reference (category on a transfer, transfer
    // account on income/expense).
    const merged = this.normalize({
      type: dto.type ?? before.type,
      accountId: dto.accountId ?? before.accountId,
      amountCents: dto.amountCents ?? before.amountCents,
      categoryId: dto.categoryId ?? before.categoryId,
      transferAccountId: dto.transferAccountId ?? before.transferAccountId,
    });
    await this.validateReferences(householdId, merged);

    existing.type = merged.type;
    existing.accountId = new Types.ObjectId(
      merged.accountId,
    ) as unknown as typeof existing.accountId;
    existing.amountCents = merged.amountCents;
    existing.categoryId = (merged.categoryId
      ? new Types.ObjectId(merged.categoryId)
      : undefined) as unknown as typeof existing.categoryId;
    existing.transferAccountId = (merged.transferAccountId
      ? new Types.ObjectId(merged.transferAccountId)
      : undefined) as unknown as typeof existing.transferAccountId;
    if (dto.date !== undefined) existing.date = new Date(dto.date);
    if (dto.payee !== undefined) existing.payee = dto.payee;
    if (dto.notes !== undefined) existing.notes = dto.notes;
    if (dto.tags !== undefined) existing.tags = dto.tags;
    if (dto.cleared !== undefined) existing.cleared = dto.cleared;
    const saved = await existing.save();

    // Reverse the old effect on the old account(s), then apply the new effect.
    await this.syncBalances(
      householdId,
      this.balanceDeltas(before),
      this.balanceDeltas(merged),
      id,
    );

    this.logger.log({ householdId, transactionId: id }, 'Transaction updated');
    return saved;
  }

  async remove(householdId: string, id: string): Promise<void> {
    const existing = await this.findOne(householdId, id);
    const before = this.fromDocument(existing);

    await this.transactionModel
      .deleteOne({ _id: existing._id } as Record<string, unknown>)
      .exec();

    // Reverse the deleted transaction's effect on its account balance(s).
    await this.syncBalances(householdId, this.balanceDeltas(before), [], id);
    this.logger.log({ householdId, transactionId: id }, 'Transaction deleted');
  }

  // --- helpers -------------------------------------------------------------

  // Normalize a desired transaction state: clear the reference that doesn't
  // apply to the type so a type switch can't carry a stale category/transfer.
  private normalize(input: ResolvedTransaction): ResolvedTransaction {
    if (input.type === TransactionType.TRANSFER) {
      return { ...input, categoryId: undefined };
    }
    return { ...input, transferAccountId: undefined };
  }

  // Validate that every referenced account/category belongs to the caller's
  // household and that the type/reference combination is coherent. Bad
  // references are a client error (400), not a 404 — the transaction itself is
  // what's being created/updated.
  private async validateReferences(
    householdId: string,
    t: ResolvedTransaction,
    forCreate = false,
  ): Promise<void> {
    const account = await this.assertAccountInHousehold(
      householdId,
      t.accountId,
    );
    // New activity can't be recorded against an archived account, but updates
    // and deletes still must work so existing entries can be corrected/reversed.
    if (forCreate && account.isArchived) {
      throw new BadRequestException(
        'Cannot record a transaction on an archived account',
      );
    }

    if (t.type === TransactionType.TRANSFER) {
      if (!t.transferAccountId) {
        throw new BadRequestException(
          'A transfer requires a transferAccountId',
        );
      }
      if (t.transferAccountId === t.accountId) {
        throw new BadRequestException(
          'A transfer must use two different accounts',
        );
      }
      const destination = await this.assertAccountInHousehold(
        householdId,
        t.transferAccountId,
      );
      if (forCreate && destination.isArchived) {
        throw new BadRequestException('Cannot transfer to an archived account');
      }
    } else {
      if (!t.categoryId) {
        throw new BadRequestException(
          'Income and expense transactions require a categoryId',
        );
      }
      const category = await this.categoriesService.findInHousehold(
        householdId,
        t.categoryId,
      );
      if (!category) {
        throw new BadRequestException(
          'categoryId does not reference a category in this household',
        );
      }
    }
  }

  private async assertAccountInHousehold(
    householdId: string,
    accountId: string,
  ): Promise<AccountDocument> {
    try {
      return await this.accountsService.findOne(householdId, accountId);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw new BadRequestException(
          `accountId "${accountId}" does not reference an account in this household`,
        );
      }
      throw error;
    }
  }

  // The signed integer effect(s) a transaction has on account balances.
  private balanceDeltas(t: ResolvedTransaction): BalanceDelta[] {
    switch (t.type) {
      case TransactionType.INCOME:
        return [{ accountId: t.accountId, deltaCents: t.amountCents }];
      case TransactionType.EXPENSE:
        return [{ accountId: t.accountId, deltaCents: -t.amountCents }];
      case TransactionType.TRANSFER:
        return [
          { accountId: t.accountId, deltaCents: -t.amountCents },
          {
            accountId: t.transferAccountId as string,
            deltaCents: t.amountCents,
          },
        ];
    }
  }

  /**
   * Reverse a set of old balance effects and apply a set of new ones, keeping
   * cached account balances in sync after a transaction write.
   *
   * Accepted trade-off: this app has no multi-document transactions (consistent
   * with the rest of the codebase), so the transaction document is persisted
   * before these `$inc`s run. If one throws — including the second leg of a
   * transfer after the first succeeded — the cached balance can drift from the
   * ledger. We can't roll back here, so we log the failure with full context
   * (turning a silent drift into a greppable event) and rethrow; the balance can
   * be re-derived from the ledger if reconciliation is ever needed.
   */
  private async syncBalances(
    householdId: string,
    reverse: BalanceDelta[],
    apply: BalanceDelta[],
    transactionId: string,
  ): Promise<void> {
    try {
      await this.applyDeltas(householdId, reverse, -1);
      await this.applyDeltas(householdId, apply, 1);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        { householdId, transactionId },
        `Balance sync failed after the transaction was persisted; cached ` +
          `balance may be drifted from the ledger: ${message}`,
      );
      throw error;
    }
  }

  private async applyDeltas(
    householdId: string,
    deltas: BalanceDelta[],
    sign: 1 | -1,
  ): Promise<void> {
    for (const { accountId, deltaCents } of deltas) {
      await this.accountsService.applyBalanceDelta(
        householdId,
        accountId,
        sign * deltaCents,
      );
    }
  }

  private fromDocument(doc: TransactionDocument): ResolvedTransaction {
    return {
      type: doc.type,
      accountId: (doc.accountId as unknown as Types.ObjectId).toString(),
      amountCents: doc.amountCents,
      categoryId: doc.categoryId
        ? (doc.categoryId as unknown as Types.ObjectId).toString()
        : undefined,
      transferAccountId: doc.transferAccountId
        ? (doc.transferAccountId as unknown as Types.ObjectId).toString()
        : undefined,
    };
  }
}
