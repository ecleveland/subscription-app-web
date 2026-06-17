import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Account, AccountDocument } from './schemas/account.schema';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';

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
    const account = new this.accountModel({
      householdId: new Types.ObjectId(householdId),
      name: dto.name,
      type: dto.type,
      balanceCents: dto.balanceCents ?? 0,
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
