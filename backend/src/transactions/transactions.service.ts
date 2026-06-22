import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import {
  Transaction,
  TransactionDocument,
  TransactionType,
} from './schemas/transaction.schema';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { QueryTransactionDto } from './dto/query-transaction.dto';
import { ImportTransactionsDto } from './dto/import-transactions.dto';
import type {
  ImportResult,
  ImportRowError,
} from './interfaces/import-result.interface';
import { parseAmountToCents } from './csv-import.util';
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

// One row of the monthly budget-vs-actual aggregation: the summed magnitude of
// a household's transactions in a single category, split by type. `categoryId`
// is a hex string (the aggregation's ObjectId `_id` stringified) so callers can
// key a plain Map without ObjectId reference-equality pitfalls. Transfers are
// excluded — they carry no category and are net-zero to the budget.
export interface MonthlyCategoryActual {
  categoryId: string;
  type: TransactionType.INCOME | TransactionType.EXPENSE;
  totalCents: number;
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

  /**
   * Sum a household's income/expense transactions for a month, grouped by
   * category and type, for the budget-vs-actual reader (VEG-439). One
   * aggregation, no N+1 per category. The month is passed as an explicit UTC
   * `[start, end)` range (the budget layer owns "YYYY-MM" → range), so the match
   * is timezone-stable. Transfers are excluded (no category, net-zero to the
   * budget). `_id` ObjectIds are stringified so callers key a plain Map safely.
   */
  async aggregateMonthlyActualsByCategory(
    householdId: string,
    start: Date,
    end: Date,
  ): Promise<MonthlyCategoryActual[]> {
    const pipeline: PipelineStage[] = [
      {
        $match: {
          householdId: new Types.ObjectId(householdId),
          type: {
            $in: [TransactionType.INCOME, TransactionType.EXPENSE],
          },
          date: { $gte: start, $lt: end },
        },
      },
      {
        $group: {
          _id: { categoryId: '$categoryId', type: '$type' },
          totalCents: { $sum: '$amountCents' },
        },
      },
    ];

    const rows = (await this.transactionModel
      .aggregate(pipeline)
      .exec()) as unknown as {
      _id: { categoryId: Types.ObjectId | null; type: TransactionType };
      totalCents: number;
    }[];

    // Drop any income/expense row missing a categoryId (shouldn't occur — the
    // create/update validation requires one — but never key a Map on null).
    // Warn if it ever does, so a data-integrity issue surfaces instead of cents
    // silently vanishing from a budget's actuals.
    const withoutCategory = rows.filter((r) => r._id.categoryId == null);
    if (withoutCategory.length > 0) {
      this.logger.warn(
        { householdId, count: withoutCategory.length },
        'Dropped income/expense transactions with no categoryId from budget actuals',
      );
    }
    return rows
      .filter((r) => r._id.categoryId != null)
      .map((r) => ({
        categoryId: (r._id.categoryId as Types.ObjectId).toString(),
        type: r._id.type as TransactionType.INCOME | TransactionType.EXPENSE,
        totalCents: r.totalCents,
      }));
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

  /**
   * Bulk-import already-parsed CSV rows into one account. Each row's amount is
   * parsed to signed cents (sign → expense/income); category column maps by name
   * to a seeded category, falling back to the household's default. Rows with an
   * unparseable amount/date are reported as row-level errors without aborting
   * the batch; rows duplicating an existing (or already-in-batch) transaction
   * are skipped so re-importing the same file is idempotent. The account balance
   * is adjusted once with the net delta of everything imported.
   */
  async importTransactions(
    householdId: string,
    memberId: string,
    dto: ImportTransactionsDto,
  ): Promise<ImportResult> {
    const account = await this.assertAccountInHousehold(
      householdId,
      dto.accountId,
    );
    if (account.isArchived) {
      throw new BadRequestException('Cannot import into an archived account');
    }

    const { byName, fallbackId } =
      await this.categoriesService.resolveImportCategories(householdId);
    if (!fallbackId) {
      throw new BadRequestException(
        'The household has no categories to import against',
      );
    }

    const accountId = account._id;
    const errors: ImportRowError[] = [];

    // Phase 1: parse each row to a candidate (or a row-level error).
    const candidates: {
      doc: Record<string, unknown>;
      type: TransactionType;
      amountCents: number;
      key: string;
    }[] = [];
    for (let i = 0; i < dto.rows.length; i++) {
      const row = dto.rows[i];
      const cents = parseAmountToCents(row[dto.mapping.amount]);
      if (cents === null) {
        errors.push({ row: i, message: 'Unparseable amount' });
        continue;
      }
      if (cents === 0) {
        errors.push({ row: i, message: 'Zero amount' });
        continue;
      }
      const date = new Date(row[dto.mapping.date]);
      if (Number.isNaN(date.getTime())) {
        errors.push({ row: i, message: 'Unparseable date' });
        continue;
      }

      const type = cents < 0 ? TransactionType.EXPENSE : TransactionType.INCOME;
      const amountCents = Math.abs(cents);
      const payee = dto.mapping.payee
        ? row[dto.mapping.payee]?.trim() || undefined
        : undefined;
      let categoryId = fallbackId;
      if (dto.mapping.category) {
        const name = row[dto.mapping.category]?.trim().toLowerCase();
        if (name && byName.has(name)) {
          categoryId = byName.get(name) as Types.ObjectId;
        }
      }

      candidates.push({
        doc: {
          householdId: new Types.ObjectId(householdId),
          accountId,
          categoryId,
          memberId: memberId ? new Types.ObjectId(memberId) : undefined,
          type,
          amountCents,
          date,
          payee,
          tags: [],
          cleared: false,
        },
        type,
        amountCents,
        // Dedupe on account + date + amount + type + payee. A null/empty payee
        // is normalized so re-imports of payee-less rows still match.
        key: `${date.getTime()}|${amountCents}|${type}|${payee ?? ''}`,
      });
    }

    // Phase 2: dedupe against existing transactions (one scoped query for the
    // batch's date window, instead of a query per row) and within the batch.
    const seen = await this.existingImportKeys(
      householdId,
      accountId,
      candidates,
    );
    const docs: Record<string, unknown>[] = [];
    let skipped = 0;
    for (const candidate of candidates) {
      if (seen.has(candidate.key)) {
        skipped += 1;
        continue;
      }
      seen.add(candidate.key);
      docs.push(candidate.doc);
    }

    // Phase 3: insert (unordered so one bad row can't strand the rest) and apply
    // the balance delta derived from what ACTUALLY persisted — never from the
    // intended set, so a partial insert can't over-apply the balance.
    let inserted: { type: TransactionType; amountCents: number }[] = [];
    if (docs.length > 0) {
      try {
        inserted = (await this.transactionModel.insertMany(docs, {
          ordered: false,
        })) as unknown as { type: TransactionType; amountCents: number }[];
      } catch (error: unknown) {
        // ordered:false → valid docs still insert; Mongoose attaches the ones
        // that landed. Apply the balance for exactly those and surface a
        // row-less error for the shortfall so it isn't silently lost.
        const partial = (error as { insertedDocs?: typeof inserted })
          .insertedDocs;
        inserted = Array.isArray(partial) ? partial : [];
        const failed = docs.length - inserted.length;
        this.logger.error(
          { householdId, accountId: dto.accountId, failed },
          `CSV import: ${failed} row(s) failed to persist`,
        );
        for (let n = 0; n < failed; n++) {
          errors.push({ row: -1, message: 'Failed to persist row' });
        }
      }
    }

    const appliedDelta = inserted.reduce(
      (sum, d) =>
        sum +
        (d.type === TransactionType.EXPENSE ? -d.amountCents : d.amountCents),
      0,
    );
    try {
      await this.accountsService.applyBalanceDelta(
        householdId,
        accountId.toString(),
        appliedDelta,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        { householdId, accountId: dto.accountId, imported: inserted.length },
        `Import balance apply failed after rows were persisted; cached balance ` +
          `may be drifted: ${message}`,
      );
      throw error;
    }

    this.logger.log(
      {
        householdId,
        accountId: dto.accountId,
        imported: inserted.length,
        skipped,
      },
      'Transactions imported',
    );
    return { imported: inserted.length, skipped, errors };
  }

  // Build the set of dedupe keys for transactions already stored on the account
  // within the batch's date window — one query, vs a findOne per row.
  private async existingImportKeys(
    householdId: string,
    accountId: Types.ObjectId,
    candidates: { doc: Record<string, unknown> }[],
  ): Promise<Set<string>> {
    const keys = new Set<string>();
    if (candidates.length === 0) {
      return keys;
    }
    const dates = candidates.map((c) => c.doc.date as Date);
    const min = new Date(Math.min(...dates.map((d) => d.getTime())));
    const max = new Date(Math.max(...dates.map((d) => d.getTime())));

    const existing = await this.transactionModel
      .find({
        householdId: new Types.ObjectId(householdId),
        accountId,
        date: { $gte: min, $lte: max },
      } as Record<string, unknown>)
      .select('date amountCents type payee')
      .lean()
      .exec();

    for (const t of existing as unknown as {
      date: Date;
      amountCents: number;
      type: TransactionType;
      payee?: string;
    }[]) {
      keys.add(
        `${new Date(t.date).getTime()}|${t.amountCents}|${t.type}|${t.payee ?? ''}`,
      );
    }
    return keys;
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
