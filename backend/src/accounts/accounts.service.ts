import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Account, AccountDocument } from './schemas/account.schema';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';

// A lean projection of the fields balance reconciliation (VEG-478) needs: the
// cached balance to compare against and the opening-balance anchor to recompute
// from. Ids are stringified so callers key plain Maps without ObjectId identity
// pitfalls, mirroring the aggregation helpers elsewhere.
export interface AccountBalanceView {
  id: string;
  householdId: string;
  name: string;
  balanceCents: number;
  // Deliberately `| undefined`: this is read with `.lean()`, which bypasses
  // Mongoose hydration and so does NOT apply the schema's `default: 0`. A legacy
  // account that predates the anchor (before its boot backfill) genuinely yields
  // `undefined` here. Typing it honestly forces every consumer to guard the
  // anchor before arithmetic (a missing anchor must be skipped, never treated
  // as 0 — that would wipe the opening balance).
  openingBalanceCents: number | undefined;
}

// A legacy account still missing the opening-balance anchor, plus the inputs the
// one-time backfill needs to derive it (`openingBalanceCents = balanceCents −
// Σ ledger`).
export interface AccountMissingOpeningBalance {
  id: string;
  householdId: string;
  balanceCents: number;
}

@Injectable()
export class AccountsService {
  private readonly logger = new Logger(AccountsService.name);

  constructor(
    @InjectModel(Account.name)
    private readonly accountModel: Model<AccountDocument>,
  ) {}

  /**
   * Create an account for a household. The opening `balanceCents` (default 0) is
   * stored directly; once transactions exist the balance is maintained by the
   * ledger's recompute-on-write (VEG-399). Money is always integer cents.
   */
  async create(
    householdId: string,
    dto: CreateAccountDto,
  ): Promise<AccountDocument> {
    const openingBalanceCents = dto.balanceCents ?? 0;
    const account = new this.accountModel({
      householdId: new Types.ObjectId(householdId),
      name: dto.name,
      type: dto.type,
      balanceCents: openingBalanceCents,
      // The opening balance is the immutable anchor for balance reconciliation
      // (VEG-478): at create there is no ledger, so it equals the cached balance.
      openingBalanceCents,
    });
    const saved = await account.save();
    this.logger.log(
      { householdId, accountId: saved._id.toString() },
      'Account created',
    );
    return saved;
  }

  /**
   * List a household's accounts. Active accounts only by default; pass
   * `includeArchived` to include archived ones. Ordered newest-first to match
   * the rest of the app's default ordering.
   */
  async findAll(
    householdId: string,
    includeArchived = false,
  ): Promise<AccountDocument[]> {
    const filter: Record<string, unknown> = {
      householdId: new Types.ObjectId(householdId),
    };
    if (!includeArchived) {
      filter.isArchived = false;
    }
    return this.accountModel.find(filter).sort({ createdAt: -1 }).exec();
  }

  /**
   * Get one account, scoped to the household. Throws NotFoundException if the id
   * doesn't exist or belongs to another household — mirroring the subscription
   * scoping so cross-household reads surface as 404, never a leak.
   */
  async findOne(householdId: string, id: string): Promise<AccountDocument> {
    // A malformed id would make findById throw a Mongoose CastError (→ 500);
    // treat it as a clean 404 so a bad path param can't leak a different status
    // than a real not-found, keeping the "never a leak" promise total.
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`Account with ID "${id}" not found`);
    }
    const account = await this.accountModel.findById(id).exec();
    if (
      !account ||
      !account.householdId ||
      !new Types.ObjectId(householdId).equals(
        account.householdId as unknown as Types.ObjectId,
      )
    ) {
      throw new NotFoundException(`Account with ID "${id}" not found`);
    }
    return account;
  }

  /** Update an account (name/type/archive flag), scoped to the household. */
  async update(
    householdId: string,
    id: string,
    dto: UpdateAccountDto,
  ): Promise<AccountDocument> {
    const existing = await this.findOne(householdId, id);
    // Assign only the fields actually provided. A PartialType DTO instance can
    // carry unset optional fields as `undefined` own-properties (TS class
    // fields); assigning those would clobber required schema fields like
    // `isArchived`/`balanceCents` and fail validation on save.
    for (const [key, value] of Object.entries(dto)) {
      if (value !== undefined) {
        (existing as unknown as Record<string, unknown>)[key] = value;
      }
    }
    const saved = await existing.save();
    this.logger.log({ householdId, accountId: id }, 'Account updated');
    return saved;
  }

  /**
   * Atomically adjust an account's cached balance by an integer delta, scoped
   * to the household. Used by the transaction ledger to keep `balanceCents` in
   * sync on every write (create applies the effect, delete reverses it, update
   * reverses-old-then-applies-new). A no-op delta is skipped. Integer cents only.
   */
  async applyBalanceDelta(
    householdId: string,
    accountId: string,
    deltaCents: number,
  ): Promise<void> {
    if (deltaCents === 0) {
      return;
    }
    const result = await this.accountModel
      .updateOne(
        {
          _id: new Types.ObjectId(accountId),
          householdId: new Types.ObjectId(householdId),
        } as Record<string, unknown>,
        { $inc: { balanceCents: deltaCents } },
      )
      .exec();
    // The caller has already validated the account belongs to the household, so
    // a zero match means the account vanished underneath us (concurrent hard
    // delete). The $inc silently no-ops, leaving the cached balance drifted —
    // surface it loudly rather than letting it pass unnoticed.
    if (result.matchedCount === 0) {
      this.logger.error(
        { householdId, accountId, deltaCents },
        'applyBalanceDelta matched no account; cached balance is now drifted',
      );
    }
  }

  /**
   * Project the accounts balance reconciliation (VEG-478) needs. Scoped to one
   * household when `householdId` is given (the household-scoped ops run),
   * otherwise every account across every household (the weekly sweep). Archived
   * accounts are included — they still carry a ledger and a cached balance that
   * can drift, so they must be reconciled. Lean read: this is a bulk scan.
   */
  async findForReconcile(householdId?: string): Promise<AccountBalanceView[]> {
    const filter: Record<string, unknown> = {};
    if (householdId) {
      filter.householdId = new Types.ObjectId(householdId);
    }
    const docs = await this.accountModel
      .find(filter)
      .select('_id householdId name balanceCents openingBalanceCents')
      .lean()
      .exec();
    return docs.map((doc) => ({
      id: doc._id.toString(),
      householdId: (doc.householdId as unknown as Types.ObjectId).toString(),
      name: doc.name,
      balanceCents: doc.balanceCents,
      openingBalanceCents: doc.openingBalanceCents,
    }));
  }

  /**
   * Optimistic compare-and-set of an account's cached balance, scoped to the
   * household. Writes `newCents` only if the stored balance still equals
   * `expectedCents` (the value reconciliation derived its correction against);
   * returns whether the write landed. This is how reconciliation corrects drift
   * without a multi-document transaction (which this codebase deliberately
   * avoids): if a legitimate ledger write raced in after the balance was read,
   * the CAS misses and the caller defers the account to the next run rather than
   * clobbering that write. Integer cents only — a non-integer target is an
   * upstream bug, so throw loudly rather than persist a corrupt cache.
   */
  async compareAndSetBalance(
    householdId: string,
    accountId: string,
    expectedCents: number,
    newCents: number,
  ): Promise<boolean> {
    if (!Number.isInteger(newCents)) {
      throw new Error(
        `Refusing to set non-integer balance ${newCents} on account ${accountId}`,
      );
    }
    const result = await this.accountModel
      .updateOne(
        {
          _id: new Types.ObjectId(accountId),
          householdId: new Types.ObjectId(householdId),
          balanceCents: expectedCents,
        } as Record<string, unknown>,
        { $set: { balanceCents: newCents } },
      )
      .exec();
    return result.matchedCount === 1;
  }

  /**
   * The legacy accounts that predate the `openingBalanceCents` anchor (VEG-478)
   * and still need it stamped. Queried by `$exists: false` against raw
   * documents, which the schema's hydration default does not affect. Returns the
   * inputs the one-time boot backfill derives the anchor from.
   */
  async findAccountsMissingOpeningBalance(): Promise<
    AccountMissingOpeningBalance[]
  > {
    const docs = await this.accountModel
      .find({ openingBalanceCents: { $exists: false } } as Record<
        string,
        unknown
      >)
      .select('_id householdId balanceCents')
      .lean()
      .exec();
    return docs.map((doc) => ({
      id: doc._id.toString(),
      householdId: (doc.householdId as unknown as Types.ObjectId).toString(),
      balanceCents: doc.balanceCents,
    }));
  }

  /**
   * Stamp the opening-balance anchor on a legacy account, but only if it is
   * still unset. The `$exists: false` guard in the filter makes concurrent-boot
   * backfills race-safe (the loser no-ops) and keeps the backfill idempotent —
   * a re-run matches nothing. Returns whether this call did the stamping.
   */
  async setOpeningBalanceIfUnset(
    accountId: string,
    valueCents: number,
  ): Promise<boolean> {
    const result = await this.accountModel
      .updateOne(
        {
          _id: new Types.ObjectId(accountId),
          openingBalanceCents: { $exists: false },
        } as Record<string, unknown>,
        { $set: { openingBalanceCents: valueCents } },
      )
      .exec();
    return result.modifiedCount === 1;
  }

  /**
   * Archive (soft-delete) an account, scoped to the household. Archiving rather
   * than deleting preserves the transactions that reference it once the ledger
   * exists (VEG-399).
   */
  async archive(householdId: string, id: string): Promise<AccountDocument> {
    const existing = await this.findOne(householdId, id);
    existing.isArchived = true;
    const saved = await existing.save();
    this.logger.log({ householdId, accountId: id }, 'Account archived');
    return saved;
  }
}
