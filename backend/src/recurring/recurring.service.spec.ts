import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { RecurringService } from './recurring.service';
import {
  RecurringTransaction,
  RecurringCadence,
  RecurringType,
} from './schemas/recurring-transaction.schema';
import { AccountsService } from '../accounts/accounts.service';
import { CategoriesService } from '../categories/categories.service';
import { TransactionsService } from '../transactions/transactions.service';

const HOUSEHOLD_ID = '507f191e810c19729de860ea';
const MEMBER_ID = '507f191e810c19729de860e1';
const ACC_ID = '507f191e810c19729de860a1';
const OTHER_ACC_ID = '507f191e810c19729de860a2';
const CAT_ID = '507f191e810c19729de860d4';
const OTHER_CAT_ID = '507f191e810c19729de860d5';
const REC_ID = '507f191e810c19729de860f5';
const OTHER_HOUSEHOLD_ID = '507f191e810c19729de860eb';

function createChainable(resolvedValue: any = null) {
  const chain: any = {};
  chain.sort = jest.fn().mockReturnValue(chain);
  chain.exec = jest.fn().mockResolvedValue(resolvedValue);
  return chain;
}

// A stored recurring-schedule doc shape for findById-based paths.
function recDoc(overrides: Record<string, any> = {}) {
  return {
    _id: new Types.ObjectId(REC_ID),
    householdId: new Types.ObjectId(HOUSEHOLD_ID),
    accountId: new Types.ObjectId(ACC_ID),
    categoryId: new Types.ObjectId(CAT_ID),
    memberId: new Types.ObjectId(MEMBER_ID),
    type: RecurringType.EXPENSE,
    amountCents: 1999,
    payee: 'Netflix',
    tags: [],
    cadence: RecurringCadence.MONTHLY,
    nextDate: new Date('2026-08-01'),
    reminderDaysBefore: 3,
    endDate: undefined,
    isActive: true,
    isSubscription: false,
    sharedWith: undefined,
    save: jest.fn().mockImplementation(function (this: any) {
      return Promise.resolve(this);
    }),
    ...overrides,
  };
}

describe('RecurringService', () => {
  let service: RecurringService;
  let mockModel: any;
  let recSave: jest.Mock;
  let accountsService: { findOne: jest.Mock };
  let categoriesService: { findInHousehold: jest.Mock };
  let transactionsService: { materializeRecurring: jest.Mock };

  const validCreate = () => ({
    accountId: ACC_ID,
    categoryId: CAT_ID,
    type: RecurringType.EXPENSE,
    amountCents: 1999,
    payee: 'Netflix',
    cadence: RecurringCadence.MONTHLY,
    nextDate: '2026-08-01',
  });

  beforeEach(async () => {
    recSave = jest.fn().mockImplementation(function (this: any) {
      return Promise.resolve({ _id: new Types.ObjectId(REC_ID), ...this });
    });
    mockModel = jest
      .fn()
      .mockImplementation((dto) => ({ ...dto, save: recSave }));
    mockModel.find = jest.fn().mockReturnValue(createChainable([]));
    mockModel.findById = jest.fn().mockReturnValue(createChainable(null));
    mockModel.findOneAndUpdate = jest.fn();
    mockModel.updateOne = jest.fn();
    mockModel.deleteOne = jest
      .fn()
      .mockReturnValue(createChainable({ deletedCount: 1 }));

    accountsService = {
      findOne: jest.fn().mockResolvedValue({ _id: new Types.ObjectId(ACC_ID) }),
    };
    categoriesService = {
      findInHousehold: jest
        .fn()
        .mockResolvedValue({ _id: new Types.ObjectId(CAT_ID) }),
    };
    transactionsService = { materializeRecurring: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecurringService,
        {
          provide: getModelToken(RecurringTransaction.name),
          useValue: mockModel,
        },
        { provide: AccountsService, useValue: accountsService },
        { provide: CategoriesService, useValue: categoriesService },
        { provide: TransactionsService, useValue: transactionsService },
      ],
    }).compile();

    module.useLogger(false);
    service = module.get<RecurringService>(RecurringService);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => jest.clearAllMocks());

  describe('create', () => {
    it('persists the schedule with ObjectId casts and defaults tags to []', async () => {
      await service.create(HOUSEHOLD_ID, MEMBER_ID, validCreate());

      expect(mockModel).toHaveBeenCalledTimes(1);
      const doc = mockModel.mock.calls[0][0];
      expect(doc.householdId).toEqual(new Types.ObjectId(HOUSEHOLD_ID));
      expect(doc.accountId).toEqual(new Types.ObjectId(ACC_ID));
      expect(doc.categoryId).toEqual(new Types.ObjectId(CAT_ID));
      expect(doc.memberId).toEqual(new Types.ObjectId(MEMBER_ID));
      expect(doc.type).toBe(RecurringType.EXPENSE);
      expect(doc.amountCents).toBe(1999);
      expect(doc.payee).toBe('Netflix');
      expect(doc.cadence).toBe(RecurringCadence.MONTHLY);
      expect(doc.nextDate).toEqual(new Date('2026-08-01'));
      // tags is left undefined so the schema's default: [] applies (asserted
      // in the schema spec; the e2e asserts the round-tripped []).
      expect(doc.tags).toBeUndefined();
      expect(recSave).toHaveBeenCalledTimes(1);
    });

    it('omits memberId when the guard supplies none', async () => {
      await service.create(HOUSEHOLD_ID, '', validCreate());
      expect(mockModel.mock.calls[0][0].memberId).toBeUndefined();
    });

    it('derives cadenceAnchorDay from nextDate (VEG-467 month-end anchor)', async () => {
      await service.create(HOUSEHOLD_ID, MEMBER_ID, {
        ...validCreate(),
        nextDate: '2026-01-31',
      });
      expect(mockModel.mock.calls[0][0].cadenceAnchorDay).toBe(31);
    });

    it('derives the anchor in UTC, not the server local zone', async () => {
      // A late-evening UTC instant is the NEXT day west of UTC; deriving the
      // anchor with getDate() would store the wrong day-of-month on such a
      // server and shift every future occurrence by one.
      await service.create(HOUSEHOLD_ID, MEMBER_ID, {
        ...validCreate(),
        nextDate: '2026-01-31T23:30:00Z',
      });
      expect(mockModel.mock.calls[0][0].cadenceAnchorDay).toBe(31);
    });

    it('ignores a client-supplied cadenceAnchorDay (server-derived only)', async () => {
      // The field is absent from CreateRecurringDto, so whitelist:true strips
      // it before the service sees it. Belt and braces: even if one arrives,
      // the derived value must win over the client's.
      await service.create(HOUSEHOLD_ID, MEMBER_ID, {
        ...validCreate(),
        nextDate: '2026-01-31',
        cadenceAnchorDay: 7,
      } as never);
      expect(mockModel.mock.calls[0][0].cadenceAnchorDay).toBe(31);
    });

    it('stores sharedWith: null as unset (not persisted null)', async () => {
      await service.create(HOUSEHOLD_ID, MEMBER_ID, {
        ...validCreate(),
        sharedWith: null,
      });
      expect(mockModel.mock.calls[0][0].sharedWith).toBeUndefined();
    });

    it('validates the account belongs to the household', async () => {
      await service.create(HOUSEHOLD_ID, MEMBER_ID, validCreate());
      expect(accountsService.findOne).toHaveBeenCalledWith(
        HOUSEHOLD_ID,
        ACC_ID,
      );
    });

    it('rejects an income subscription with 400 (not a save-time 500)', async () => {
      await expect(
        service.create(HOUSEHOLD_ID, MEMBER_ID, {
          ...validCreate(),
          type: RecurringType.INCOME,
          isSubscription: true,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(recSave).not.toHaveBeenCalled();
    });

    it('rejects endDate strictly before nextDate', async () => {
      await expect(
        service.create(HOUSEHOLD_ID, MEMBER_ID, {
          ...validCreate(),
          endDate: '2026-07-31',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts endDate equal to nextDate (one final occurrence)', async () => {
      await service.create(HOUSEHOLD_ID, MEMBER_ID, {
        ...validCreate(),
        endDate: '2026-08-01',
      });
      expect(recSave).toHaveBeenCalledTimes(1);
    });

    it('compares the date pair at day granularity (date-only endDate vs datetime nextDate)', async () => {
      // endDate is documented as "last DATE the schedule may run" — a
      // date-only endDate on the same calendar day as a datetime nextDate
      // must not be rejected just because midnight < noon.
      await service.create(HOUSEHOLD_ID, MEMBER_ID, {
        ...validCreate(),
        nextDate: '2026-08-01T12:00:00.000Z',
        endDate: '2026-08-01',
      });
      expect(recSave).toHaveBeenCalledTimes(1);
    });

    it('parses an offsetless datetime as UTC (server-timezone independent)', async () => {
      // JS parses '2026-08-01T20:00:00' (no offset) in the SERVER's local
      // zone while date-only strings parse as UTC — on a west-of-UTC server
      // that skews the pair across a day boundary and both the validation
      // and the persisted instant become timezone-dependent.
      await service.create(HOUSEHOLD_ID, MEMBER_ID, {
        ...validCreate(),
        nextDate: '2026-08-01T20:00:00',
        endDate: '2026-08-01',
      });
      expect(recSave).toHaveBeenCalledTimes(1);
      const doc = mockModel.mock.calls[0][0];
      expect(doc.nextDate.toISOString()).toBe('2026-08-01T20:00:00.000Z');
    });

    it('rethrows non-NotFound account-lookup failures untranslated', async () => {
      // Only NotFoundException means "bad reference" — an infrastructure
      // error must never be masked as a client 400.
      accountsService.findOne.mockRejectedValue(new Error('connection reset'));
      await expect(
        service.create(HOUSEHOLD_ID, MEMBER_ID, validCreate()),
      ).rejects.toThrow('connection reset');
    });

    it('rejects an ISO string JS cannot parse (week date) as 400, not a save-time 500', async () => {
      // @IsDateString (isISO8601) passes '2026-W32', but new Date() cannot
      // parse it — without the guard it becomes Invalid Date and blows up
      // inside Mongoose at save.
      await expect(
        service.create(HOUSEHOLD_ID, MEMBER_ID, {
          ...validCreate(),
          nextDate: '2026-W32',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(recSave).not.toHaveBeenCalled();
    });

    it('rejects an unparseable endDate (ordinal date)', async () => {
      await expect(
        service.create(HOUSEHOLD_ID, MEMBER_ID, {
          ...validCreate(),
          endDate: '2026-213',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an account from another household as 400, not 404', async () => {
      accountsService.findOne.mockRejectedValue(new NotFoundException());
      await expect(
        service.create(HOUSEHOLD_ID, MEMBER_ID, validCreate()),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an archived account', async () => {
      accountsService.findOne.mockResolvedValue({
        _id: new Types.ObjectId(ACC_ID),
        isArchived: true,
      });
      await expect(
        service.create(HOUSEHOLD_ID, MEMBER_ID, validCreate()),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a category not in the household', async () => {
      categoriesService.findInHousehold.mockResolvedValue(null);
      await expect(
        service.create(HOUSEHOLD_ID, MEMBER_ID, validCreate()),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an archived category', async () => {
      categoriesService.findInHousehold.mockResolvedValue({
        _id: new Types.ObjectId(CAT_ID),
        isArchived: true,
      });
      await expect(
        service.create(HOUSEHOLD_ID, MEMBER_ID, validCreate()),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findAll', () => {
    it('scopes to the household, excludes subscriptions by default, sorts by nextDate asc', async () => {
      const chain = createChainable([recDoc()]);
      mockModel.find.mockReturnValue(chain);

      const result = await service.findAll(HOUSEHOLD_ID, {});

      // Subscriptions are excluded from the Bills view unless explicitly asked
      // for (VEG-469) — they have their own /api/subscriptions endpoint.
      expect(mockModel.find).toHaveBeenCalledWith({
        householdId: new Types.ObjectId(HOUSEHOLD_ID),
        isSubscription: false,
      });
      expect(chain.sort).toHaveBeenCalledWith({ nextDate: 1 });
      expect(result).toHaveLength(1);
    });

    it('opts subscriptions back in with isSubscription: true', async () => {
      await service.findAll(HOUSEHOLD_ID, { isSubscription: true });
      expect(mockModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ isSubscription: true }),
      );
    });

    it('applies the type filter', async () => {
      await service.findAll(HOUSEHOLD_ID, { type: RecurringType.INCOME });
      expect(mockModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ type: RecurringType.INCOME }),
      );
    });

    it('applies isSubscription: false (explicit false is not "unset")', async () => {
      await service.findAll(HOUSEHOLD_ID, { isSubscription: false });
      expect(mockModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ isSubscription: false }),
      );
    });

    it('applies isActive: false', async () => {
      await service.findAll(HOUSEHOLD_ID, { isActive: false });
      expect(mockModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: false }),
      );
    });

    it('casts accountId and categoryId filters to ObjectId', async () => {
      await service.findAll(HOUSEHOLD_ID, {
        accountId: ACC_ID,
        categoryId: CAT_ID,
      });
      expect(mockModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: new Types.ObjectId(ACC_ID),
          categoryId: new Types.ObjectId(CAT_ID),
        }),
      );
    });
  });

  describe('findOne', () => {
    it('returns the household-owned schedule', async () => {
      const doc = recDoc();
      mockModel.findById.mockReturnValue(createChainable(doc));
      expect(await service.findOne(HOUSEHOLD_ID, REC_ID)).toBe(doc);
    });

    it('404s on a malformed id without querying', async () => {
      await expect(service.findOne(HOUSEHOLD_ID, 'nope')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockModel.findById).not.toHaveBeenCalled();
    });

    it('404s when the schedule does not exist', async () => {
      await expect(service.findOne(HOUSEHOLD_ID, REC_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("404s on another household's schedule (no existence leak)", async () => {
      mockModel.findById.mockReturnValue(
        createChainable(
          recDoc({ householdId: new Types.ObjectId(OTHER_HOUSEHOLD_ID) }),
        ),
      );
      await expect(service.findOne(HOUSEHOLD_ID, REC_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('merges the patch onto the doc and saves via document save', async () => {
      const doc = recDoc();
      mockModel.findById.mockReturnValue(createChainable(doc));

      const result = await service.update(HOUSEHOLD_ID, REC_ID, {
        amountCents: 2499,
      });

      expect(doc.amountCents).toBe(2499);
      expect(doc.payee).toBe('Netflix');
      expect(doc.save).toHaveBeenCalledTimes(1);
      // The isSubscription cross-field validator only runs on the document
      // save path — query-based updates must never be used here.
      expect(mockModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(mockModel.updateOne).not.toHaveBeenCalled();
      expect(result).toBe(doc);
    });

    it('re-anchors cadenceAnchorDay when nextDate moves', async () => {
      const doc = recDoc({ cadenceAnchorDay: 1 });
      mockModel.findById.mockReturnValue(createChainable(doc));

      await service.update(HOUSEHOLD_ID, REC_ID, { nextDate: '2026-09-30' });

      expect(doc.cadenceAnchorDay).toBe(30);
    });

    it('re-anchors when cadence changes without an explicit nextDate', async () => {
      // A weekly schedule's nextDate walks forward on every cron run while the
      // anchor stays frozen at its creation day (addCadence ignores the anchor
      // for weekly). Switching to monthly would otherwise hand that stale
      // anchor authority over the posting date: a schedule sitting on Mar 7
      // would jump to Apr 30 instead of Apr 7.
      const doc = recDoc({
        cadence: RecurringCadence.WEEKLY,
        cadenceAnchorDay: 31,
        nextDate: new Date('2026-03-07T00:00:00Z'),
      });
      mockModel.findById.mockReturnValue(createChainable(doc));

      await service.update(HOUSEHOLD_ID, REC_ID, {
        cadence: RecurringCadence.MONTHLY,
      });

      expect(doc.cadenceAnchorDay).toBe(7);
    });

    it('lets an explicit nextDate win when cadence changes too', async () => {
      const doc = recDoc({
        cadence: RecurringCadence.WEEKLY,
        cadenceAnchorDay: 31,
        nextDate: new Date('2026-03-07T00:00:00Z'),
      });
      mockModel.findById.mockReturnValue(createChainable(doc));

      await service.update(HOUSEHOLD_ID, REC_ID, {
        cadence: RecurringCadence.MONTHLY,
        nextDate: '2026-04-15',
      });

      expect(doc.cadenceAnchorDay).toBe(15);
    });

    it('leaves the anchor alone when the patch does not touch nextDate', async () => {
      // Re-deriving on every patch would let an unrelated edit (a rename)
      // silently rewrite the anchor from a clamped nextDate — the exact
      // degradation the field exists to prevent.
      const doc = recDoc({
        cadenceAnchorDay: 31,
        nextDate: new Date('2026-02-28'),
      });
      mockModel.findById.mockReturnValue(createChainable(doc));

      await service.update(HOUSEHOLD_ID, REC_ID, { payee: 'Renamed' });

      expect(doc.cadenceAnchorDay).toBe(31);
    });

    it('rejects switching a subscription to income', async () => {
      mockModel.findById.mockReturnValue(
        createChainable(recDoc({ isSubscription: true })),
      );
      await expect(
        service.update(HOUSEHOLD_ID, REC_ID, { type: RecurringType.INCOME }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects marking an income schedule as a subscription', async () => {
      mockModel.findById.mockReturnValue(
        createChainable(recDoc({ type: RecurringType.INCOME })),
      );
      await expect(
        service.update(HOUSEHOLD_ID, REC_ID, { isSubscription: true }),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts isSubscription: true when the same patch switches to expense', async () => {
      const doc = recDoc({ type: RecurringType.INCOME });
      mockModel.findById.mockReturnValue(createChainable(doc));
      await service.update(HOUSEHOLD_ID, REC_ID, {
        type: RecurringType.EXPENSE,
        isSubscription: true,
      });
      expect(doc.save).toHaveBeenCalled();
    });

    it('re-validates a changed accountId', async () => {
      mockModel.findById.mockReturnValue(createChainable(recDoc()));
      accountsService.findOne.mockRejectedValue(new NotFoundException());
      await expect(
        service.update(HOUSEHOLD_ID, REC_ID, { accountId: OTHER_ACC_ID }),
      ).rejects.toThrow(BadRequestException);
      expect(accountsService.findOne).toHaveBeenCalledWith(
        HOUSEHOLD_ID,
        OTHER_ACC_ID,
      );
    });

    it('rejects re-pointing onto an archived account', async () => {
      mockModel.findById.mockReturnValue(createChainable(recDoc()));
      accountsService.findOne.mockResolvedValue({
        _id: new Types.ObjectId(OTHER_ACC_ID),
        isArchived: true,
      });
      await expect(
        service.update(HOUSEHOLD_ID, REC_ID, { accountId: OTHER_ACC_ID }),
      ).rejects.toThrow(BadRequestException);
    });

    it('skips account validation when accountId is unchanged', async () => {
      mockModel.findById.mockReturnValue(createChainable(recDoc()));
      await service.update(HOUSEHOLD_ID, REC_ID, { accountId: ACC_ID });
      expect(accountsService.findOne).not.toHaveBeenCalled();
    });

    it('treats the same id in uppercase hex as unchanged (@IsMongoId admits uppercase)', async () => {
      // A client echoing the current reference uppercased must not be
      // misclassified as a re-point — that would 400 corrections on
      // schedules whose reference was archived after create.
      mockModel.findById.mockReturnValue(createChainable(recDoc()));
      await service.update(HOUSEHOLD_ID, REC_ID, {
        accountId: ACC_ID.toUpperCase(),
        categoryId: CAT_ID.toUpperCase(),
      });
      expect(accountsService.findOne).not.toHaveBeenCalled();
      expect(categoriesService.findInHousehold).not.toHaveBeenCalled();
    });

    it('rejects moving nextDate past the stored endDate', async () => {
      // Proves the EXISTING endDate is merged into the validated state —
      // not only patches that send both dates.
      mockModel.findById.mockReturnValue(
        createChainable(recDoc({ endDate: new Date('2026-12-31') })),
      );
      await expect(
        service.update(HOUSEHOLD_ID, REC_ID, { nextDate: '2027-01-15' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('checks only the incoming account when a reactivation also re-points', async () => {
      const doc = recDoc({ isActive: false });
      mockModel.findById.mockReturnValue(createChainable(doc));
      await service.update(HOUSEHOLD_ID, REC_ID, {
        isActive: true,
        accountId: OTHER_ACC_ID,
      });
      expect(accountsService.findOne).toHaveBeenCalledTimes(1);
      expect(accountsService.findOne).toHaveBeenCalledWith(
        HOUSEHOLD_ID,
        OTHER_ACC_ID,
      );
      // Category is unchanged but the schedule is being reactivated, so it
      // still gets checked.
      expect(categoriesService.findInHousehold).toHaveBeenCalledWith(
        HOUSEHOLD_ID,
        CAT_ID,
      );
    });

    it('validates the incoming account on a legacy doc with no accountId', async () => {
      // Migrated legacy subscriptions (VEG-469) have no accountId; assigning
      // one must validate it — and must not crash on the missing existing ref.
      const doc = recDoc({ accountId: undefined });
      mockModel.findById.mockReturnValue(createChainable(doc));
      await service.update(HOUSEHOLD_ID, REC_ID, { accountId: ACC_ID });
      expect(accountsService.findOne).toHaveBeenCalledWith(
        HOUSEHOLD_ID,
        ACC_ID,
      );
      expect(doc.save).toHaveBeenCalled();
    });

    it('rejects re-pointing onto an archived category', async () => {
      mockModel.findById.mockReturnValue(createChainable(recDoc()));
      categoriesService.findInHousehold.mockResolvedValue({
        _id: new Types.ObjectId(OTHER_CAT_ID),
        isArchived: true,
      });
      await expect(
        service.update(HOUSEHOLD_ID, REC_ID, { categoryId: OTHER_CAT_ID }),
      ).rejects.toThrow(BadRequestException);
    });

    it('leaves an unchanged (possibly archived) category untouched when patching other fields', async () => {
      mockModel.findById.mockReturnValue(createChainable(recDoc()));
      await service.update(HOUSEHOLD_ID, REC_ID, { payee: 'Hulu' });
      expect(categoriesService.findInHousehold).not.toHaveBeenCalled();
    });

    it('rejects a patched endDate before the existing nextDate', async () => {
      mockModel.findById.mockReturnValue(createChainable(recDoc()));
      await expect(
        service.update(HOUSEHOLD_ID, REC_ID, { endDate: '2026-07-01' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('skips the date-pair check when the patch touches neither date', async () => {
      // A scheduler-completed doc (nextDate advanced past endDate, VEG-467)
      // must stay editable.
      const doc = recDoc({
        nextDate: new Date('2026-09-01'),
        endDate: new Date('2026-08-15'),
      });
      mockModel.findById.mockReturnValue(createChainable(doc));
      await service.update(HOUSEHOLD_ID, REC_ID, { payee: 'Hulu' });
      expect(doc.save).toHaveBeenCalled();
    });

    it('clears endDate on explicit null', async () => {
      const doc = recDoc({ endDate: new Date('2026-12-01') });
      mockModel.findById.mockReturnValue(createChainable(doc));
      await service.update(HOUSEHOLD_ID, REC_ID, { endDate: null });
      expect(doc.endDate).toBeUndefined();
      expect(doc.save).toHaveBeenCalled();
    });

    it('clears sharedWith on explicit null', async () => {
      const doc = recDoc({ sharedWith: 3 });
      mockModel.findById.mockReturnValue(createChainable(doc));
      await service.update(HOUSEHOLD_ID, REC_ID, { sharedWith: null });
      expect(doc.sharedWith).toBeUndefined();
      expect(doc.save).toHaveBeenCalled();
    });

    it('rejects an unparseable patched nextDate as 400', async () => {
      mockModel.findById.mockReturnValue(createChainable(recDoc()));
      await expect(
        service.update(HOUSEHOLD_ID, REC_ID, { nextDate: '2026-W32' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects reactivating a schedule whose account was archived', async () => {
      // Pause → archive account → PATCH { isActive: true } must not sneak new
      // activity onto the archived account once the scheduler (VEG-467) runs.
      mockModel.findById.mockReturnValue(
        createChainable(recDoc({ isActive: false })),
      );
      accountsService.findOne.mockResolvedValue({
        _id: new Types.ObjectId(ACC_ID),
        isArchived: true,
      });
      await expect(
        service.update(HOUSEHOLD_ID, REC_ID, { isActive: true }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects reactivating a schedule whose category was archived', async () => {
      mockModel.findById.mockReturnValue(
        createChainable(recDoc({ isActive: false })),
      );
      categoriesService.findInHousehold.mockResolvedValue({
        _id: new Types.ObjectId(CAT_ID),
        isArchived: true,
      });
      await expect(
        service.update(HOUSEHOLD_ID, REC_ID, { isActive: true }),
      ).rejects.toThrow(BadRequestException);
    });

    it('reactivates a paused schedule with usable references', async () => {
      const doc = recDoc({ isActive: false });
      mockModel.findById.mockReturnValue(createChainable(doc));
      await service.update(HOUSEHOLD_ID, REC_ID, { isActive: true });
      expect(accountsService.findOne).toHaveBeenCalledWith(
        HOUSEHOLD_ID,
        ACC_ID,
      );
      expect(categoriesService.findInHousehold).toHaveBeenCalledWith(
        HOUSEHOLD_ID,
        CAT_ID,
      );
      expect(doc.isActive).toBe(true);
      expect(doc.save).toHaveBeenCalled();
    });

    it('skips reference checks when isActive: true is a no-op (already active)', async () => {
      // A correction PATCH carrying isActive: true on an active schedule must
      // not start rejecting docs whose references were archived after create.
      mockModel.findById.mockReturnValue(createChainable(recDoc()));
      await service.update(HOUSEHOLD_ID, REC_ID, {
        isActive: true,
        payee: 'Corrected',
      });
      expect(accountsService.findOne).not.toHaveBeenCalled();
      expect(categoriesService.findInHousehold).not.toHaveBeenCalled();
    });

    it('reactivates a legacy account-less schedule by checking only the category', async () => {
      const doc = recDoc({ isActive: false, accountId: undefined });
      mockModel.findById.mockReturnValue(createChainable(doc));
      await service.update(HOUSEHOLD_ID, REC_ID, { isActive: true });
      expect(accountsService.findOne).not.toHaveBeenCalled();
      expect(categoriesService.findInHousehold).toHaveBeenCalled();
      expect(doc.save).toHaveBeenCalled();
    });

    it("404s when updating another household's schedule", async () => {
      mockModel.findById.mockReturnValue(
        createChainable(
          recDoc({ householdId: new Types.ObjectId(OTHER_HOUSEHOLD_ID) }),
        ),
      );
      await expect(
        service.update(HOUSEHOLD_ID, REC_ID, { payee: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('deletes with a single household-scoped atomic query', async () => {
      await service.remove(HOUSEHOLD_ID, REC_ID);
      expect(mockModel.deleteOne).toHaveBeenCalledWith({
        _id: new Types.ObjectId(REC_ID),
        householdId: new Types.ObjectId(HOUSEHOLD_ID),
      });
      expect(mockModel.findById).not.toHaveBeenCalled();
    });

    it('404s on a malformed id without querying', async () => {
      await expect(service.remove(HOUSEHOLD_ID, 'nope')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockModel.deleteOne).not.toHaveBeenCalled();
    });

    it("404s when nothing matches (missing or another household's schedule)", async () => {
      mockModel.deleteOne.mockReturnValue(createChainable({ deletedCount: 0 }));
      await expect(service.remove(HOUSEHOLD_ID, REC_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('materializeDue (VEG-467 scheduler)', () => {
    // "Today" for every case below.
    const NOW = new Date('2026-08-15T00:00:00Z');

    // A lean scan row (the cursor uses .lean(), so no save()).
    const scanDoc = (overrides: Record<string, any> = {}) => ({
      _id: new Types.ObjectId(REC_ID),
      householdId: new Types.ObjectId(HOUSEHOLD_ID),
      accountId: new Types.ObjectId(ACC_ID),
      categoryId: new Types.ObjectId(CAT_ID),
      memberId: new Types.ObjectId(MEMBER_ID),
      type: RecurringType.EXPENSE,
      amountCents: 1999,
      payee: 'Netflix',
      notes: undefined,
      tags: [],
      cadence: RecurringCadence.MONTHLY,
      nextDate: new Date('2026-08-01T00:00:00Z'),
      cadenceAnchorDay: 1,
      endDate: undefined,
      isActive: true,
      ...overrides,
    });

    // Feed the scan cursor. find(...).lean().cursor() → async-iterable.
    const scanReturns = (docs: any[]) => {
      mockModel.find.mockReturnValue({
        lean: () => ({
          cursor: () => ({
            async *[Symbol.asyncIterator]() {
              // Yield through a resolved promise so the mock is genuinely
              // async, like the real cursor the loop consumes.
              for (const d of docs) yield await Promise.resolve(d);
            },
          }),
        }),
      });
    };

    const advancedTo = (call: number): Date =>
      mockModel.updateOne.mock.calls[call][1].$set.nextDate;

    beforeEach(() => {
      scanReturns([]);
      // Every guarded advance succeeds unless a test says otherwise.
      mockModel.updateOne.mockReturnValue(
        createChainable({ matchedCount: 1, modifiedCount: 1 }),
      );
      transactionsService.materializeRecurring.mockResolvedValue({
        materialized: true,
        duplicate: false,
        transactionId: 'txn1',
      });
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    });

    it('scans only active schedules due on or before today', async () => {
      await service.materializeDue(NOW);

      const filter = mockModel.find.mock.calls[0][0];
      expect(filter.isActive).toBe(true);
      // Day granularity: a schedule due at noon TODAY is due now, even though
      // the cron fires at midnight. An `$lte: now` bound would defer it a day.
      expect(filter.nextDate.$lt).toEqual(new Date('2026-08-16T00:00:00Z'));
    });

    it('materializes a due occurrence and advances one period', async () => {
      scanReturns([scanDoc()]);

      const summary = await service.materializeDue(NOW);

      expect(transactionsService.materializeRecurring).toHaveBeenCalledTimes(1);
      const [householdId, occurrence] =
        transactionsService.materializeRecurring.mock.calls[0];
      expect(householdId).toBe(HOUSEHOLD_ID);
      expect(occurrence).toMatchObject({
        recurringId: REC_ID,
        accountId: ACC_ID,
        categoryId: CAT_ID,
        memberId: MEMBER_ID,
        type: 'expense',
        amountCents: 1999,
        payee: 'Netflix',
      });
      expect(occurrence.date).toEqual(new Date('2026-08-01T00:00:00Z'));
      expect(advancedTo(0)).toEqual(new Date('2026-09-01T00:00:00Z'));
      expect(summary).toMatchObject({ materialized: 1 });
    });

    it('maps an income schedule to an income transaction', async () => {
      scanReturns([scanDoc({ type: RecurringType.INCOME })]);
      await service.materializeDue(NOW);
      expect(
        transactionsService.materializeRecurring.mock.calls[0][1].type,
      ).toBe('income');
    });

    it('leaves a not-yet-due schedule alone', async () => {
      // Prefilter is a query concern; if one slips through (clock skew, a
      // concurrent PATCH), the loop must still decline to post early.
      scanReturns([scanDoc({ nextDate: new Date('2026-08-20T00:00:00Z') })]);

      const summary = await service.materializeDue(NOW);

      expect(transactionsService.materializeRecurring).not.toHaveBeenCalled();
      expect(mockModel.updateOne).not.toHaveBeenCalled();
      expect(summary).toMatchObject({ materialized: 0 });
    });

    it('materializes one transaction per missed period when overdue', async () => {
      // Due May 1; today is Aug 15 → May, Jun, Jul, Aug occurrences.
      scanReturns([scanDoc({ nextDate: new Date('2026-05-01T00:00:00Z') })]);

      const summary = await service.materializeDue(NOW);

      const dates = transactionsService.materializeRecurring.mock.calls.map(
        (c: any[]) => c[1].date.toISOString().slice(0, 10),
      );
      expect(dates).toEqual([
        '2026-05-01',
        '2026-06-01',
        '2026-07-01',
        '2026-08-01',
      ]);
      expect(advancedTo(3)).toEqual(new Date('2026-09-01T00:00:00Z'));
      expect(summary).toMatchObject({ materialized: 4 });
    });

    it('uses cadenceAnchorDay so a clamped month does not re-anchor', async () => {
      // Anchored on the 31st, currently sitting on the Feb 28 clamp.
      scanReturns([
        scanDoc({
          nextDate: new Date('2026-02-28T00:00:00Z'),
          cadenceAnchorDay: 31,
        }),
      ]);

      await service.materializeDue(new Date('2026-03-15T00:00:00Z'));

      expect(advancedTo(0)).toEqual(new Date('2026-03-31T00:00:00Z'));
    });

    describe('endDate', () => {
      it('materializes the final occurrence on endDate itself', async () => {
        scanReturns([
          scanDoc({
            nextDate: new Date('2026-08-01T00:00:00Z'),
            endDate: new Date('2026-08-01T00:00:00Z'),
          }),
        ]);

        const summary = await service.materializeDue(NOW);

        expect(transactionsService.materializeRecurring).toHaveBeenCalledTimes(
          1,
        );
        expect(summary).toMatchObject({ materialized: 1, deactivated: 1 });
      });

      it('deactivates once the advance carries past endDate', async () => {
        scanReturns([
          scanDoc({
            nextDate: new Date('2026-08-01T00:00:00Z'),
            endDate: new Date('2026-08-15T00:00:00Z'),
          }),
        ]);

        await service.materializeDue(NOW);

        // Same write as the final advance — no extra round trip.
        const set = mockModel.updateOne.mock.calls[0][1].$set;
        expect(set.isActive).toBe(false);
      });

      it('compares endDate at day granularity, not by instant', async () => {
        // A date-only endDate (midnight) must still admit a noon occurrence on
        // that same calendar day — matching validateScheduleState's rule.
        scanReturns([
          scanDoc({
            nextDate: new Date('2026-08-01T12:00:00Z'),
            endDate: new Date('2026-08-01T00:00:00Z'),
          }),
        ]);

        await service.materializeDue(NOW);

        expect(transactionsService.materializeRecurring).toHaveBeenCalledTimes(
          1,
        );
      });

      it('materializes nothing for a schedule already past its endDate', async () => {
        scanReturns([
          scanDoc({
            nextDate: new Date('2026-08-01T00:00:00Z'),
            endDate: new Date('2026-07-01T00:00:00Z'),
          }),
        ]);

        const summary = await service.materializeDue(NOW);

        expect(transactionsService.materializeRecurring).not.toHaveBeenCalled();
        expect(summary).toMatchObject({ materialized: 0, deactivated: 1 });
        expect(mockModel.updateOne.mock.calls[0][1].$set.isActive).toBe(false);
      });
    });

    describe('unusable references — skip without advancing', () => {
      // Leaving nextDate stale is the point: the schedule keeps floating to the
      // top of the household's nextDate-sorted list as a signal, and once the
      // reference is fixed the catch-up loop replays every missed period.
      // Advancing would silently swallow those occurrences.
      const expectSkipped = async (docOverrides: Record<string, any>) => {
        scanReturns([scanDoc(docOverrides)]);
        const summary = await service.materializeDue(NOW);
        expect(transactionsService.materializeRecurring).not.toHaveBeenCalled();
        expect(mockModel.updateOne).not.toHaveBeenCalled();
        expect(summary).toMatchObject({ skipped: 1, deactivated: 0 });
      };

      it('skips a schedule with no accountId (unmigrated legacy row)', async () => {
        await expectSkipped({ accountId: undefined });
      });

      it('skips a schedule whose account is archived', async () => {
        accountsService.findOne.mockResolvedValue({
          _id: new Types.ObjectId(ACC_ID),
          isArchived: true,
        });
        await expectSkipped({});
      });

      it('skips a schedule whose category is archived', async () => {
        categoriesService.findInHousehold.mockResolvedValue({
          _id: new Types.ObjectId(CAT_ID),
          isArchived: true,
        });
        await expectSkipped({});
      });

      it('skips a schedule whose account no longer exists', async () => {
        accountsService.findOne.mockRejectedValue(new NotFoundException());
        await expectSkipped({});
      });

      it('skips a schedule whose category no longer exists', async () => {
        categoriesService.findInHousehold.mockResolvedValue(null);
        await expectSkipped({});
      });

      it('does NOT deactivate a skipped schedule (it must self-heal)', async () => {
        accountsService.findOne.mockResolvedValue({
          _id: new Types.ObjectId(ACC_ID),
          isArchived: true,
        });
        scanReturns([scanDoc()]);

        await service.materializeDue(NOW);

        // Deactivating would strand the user: reactivation is blocked while
        // the reference is archived, so the cron would create a state the API
        // refuses to undo.
        expect(mockModel.updateOne).not.toHaveBeenCalled();
      });
    });

    describe('account-less subscriptions — advance without materializing (VEG-469)', () => {
      // A migrated subscription has no account, so it can never post to the
      // ledger — but its nextDate must still roll forward, the way the retired
      // subscription cron advanced it, or it freezes stale forever.
      const subDoc = (overrides: Record<string, any> = {}) =>
        scanDoc({ isSubscription: true, accountId: undefined, ...overrides });

      it('advances the date one period without posting a transaction', async () => {
        scanReturns([subDoc({ nextDate: new Date('2026-08-01T00:00:00Z') })]);

        const summary = await service.materializeDue(NOW);

        expect(transactionsService.materializeRecurring).not.toHaveBeenCalled();
        expect(mockModel.updateOne).toHaveBeenCalledTimes(1);
        expect(advancedTo(0)).toEqual(new Date('2026-09-01T00:00:00Z'));
        expect(summary).toMatchObject({
          advancedOnly: 1,
          materialized: 0,
          skipped: 0,
        });
      });

      it('catches up across multiple missed periods, still posting nothing', async () => {
        scanReturns([subDoc({ nextDate: new Date('2026-05-01T00:00:00Z') })]);

        const summary = await service.materializeDue(NOW);

        expect(transactionsService.materializeRecurring).not.toHaveBeenCalled();
        // 05-01 → 06-01 → 07-01 → 08-01 → 09-01 (first date strictly after today).
        expect(mockModel.updateOne).toHaveBeenCalledTimes(4);
        expect(advancedTo(3)).toEqual(new Date('2026-09-01T00:00:00Z'));
        expect(summary).toMatchObject({ advancedOnly: 4, materialized: 0 });
      });

      it('deactivates in the guarded write once it advances past endDate', async () => {
        scanReturns([
          subDoc({
            nextDate: new Date('2026-08-01T00:00:00Z'),
            endDate: new Date('2026-08-10T00:00:00Z'),
          }),
        ]);

        const summary = await service.materializeDue(NOW);

        expect(transactionsService.materializeRecurring).not.toHaveBeenCalled();
        expect(mockModel.updateOne.mock.calls[0][1].$set.isActive).toBe(false);
        expect(summary).toMatchObject({ deactivated: 1, materialized: 0 });
      });

      it('yields the remaining periods when the guarded advance misses', async () => {
        mockModel.updateOne.mockReturnValue(
          createChainable({ matchedCount: 0, modifiedCount: 0 }),
        );
        scanReturns([subDoc({ nextDate: new Date('2026-05-01T00:00:00Z') })]);

        const summary = await service.materializeDue(NOW);

        // First guarded advance matched nothing (concurrent edit / re-visit):
        // stop rather than double-advancing.
        expect(mockModel.updateOne).toHaveBeenCalledTimes(1);
        expect(summary).toMatchObject({ yielded: 1, advancedOnly: 0 });
      });
    });

    describe('crash-safety and concurrency', () => {
      it('advances past an occurrence another run already materialized', async () => {
        transactionsService.materializeRecurring.mockResolvedValueOnce({
          materialized: false,
          duplicate: true,
        });
        scanReturns([scanDoc()]);

        const summary = await service.materializeDue(NOW);

        // Treating a duplicate as "already done" and moving on is what lets a
        // resumed run finish; aborting would wedge the schedule forever.
        expect(advancedTo(0)).toEqual(new Date('2026-09-01T00:00:00Z'));
        expect(summary).toMatchObject({ materialized: 0, duplicate: 1 });
      });

      it('stops the schedule when the guarded advance loses a race', async () => {
        mockModel.updateOne.mockReturnValue(
          createChainable({ matchedCount: 0, modifiedCount: 0 }),
        );
        scanReturns([scanDoc({ nextDate: new Date('2026-05-01T00:00:00Z') })]);

        const summary = await service.materializeDue(NOW);

        // Another writer owns this schedule now — do not keep posting.
        expect(transactionsService.materializeRecurring).toHaveBeenCalledTimes(
          1,
        );
        // The abandoned periods must show up in the summary, or a run that
        // gave up mid-catch-up looks identical to one that finished cleanly.
        expect(summary).toMatchObject({ yielded: 1 });
      });

      // The entire design rationale is insert → balance → advance: the ledger
      // is the source of truth and the balance is a re-derivable cache, so a
      // crash must leave a complete ledger rather than a lost occurrence.
      // Every other test asserts both happened; reversing them would pass.
      it('inserts the transaction BEFORE advancing nextDate', async () => {
        scanReturns([scanDoc()]);

        await service.materializeDue(NOW);

        expect(
          transactionsService.materializeRecurring.mock.invocationCallOrder[0],
        ).toBeLessThan(mockModel.updateOne.mock.invocationCallOrder[0]);
      });

      // An infrastructure blip must surface as `failed`, not be laundered into
      // "unusable reference" — which would leave nextDate stale while the run
      // summary reported a clean pass.
      it('counts a transient account-lookup error as failed, not skipped', async () => {
        accountsService.findOne.mockRejectedValue(
          new Error('connection reset'),
        );
        scanReturns([scanDoc()]);

        const summary = await service.materializeDue(NOW);

        expect(summary).toMatchObject({ failed: 1, skipped: 0 });
        expect(mockModel.updateOne).not.toHaveBeenCalled();
      });

      it('counts a transient category-lookup error as failed, not skipped', async () => {
        categoriesService.findInHousehold.mockRejectedValue(
          new Error('connection reset'),
        );
        scanReturns([scanDoc()]);

        const summary = await service.materializeDue(NOW);

        expect(summary).toMatchObject({ failed: 1, skipped: 0 });
        expect(mockModel.updateOne).not.toHaveBeenCalled();
      });

      // The scheduler-side half of the balance-apply-failure contract: a
      // rethrow from materializeRecurring must demote the occurrence to
      // `failed` and leave nextDate untouched, so the occurrence is retried
      // rather than skipped past. Only observable here, not in the
      // transactions spec where the call simply rejects.
      it('counts a rejected materialization as failed and does not advance', async () => {
        transactionsService.materializeRecurring.mockRejectedValue(
          new Error('balance write failed'),
        );
        scanReturns([scanDoc()]);

        const summary = await service.materializeDue(NOW);

        expect(summary).toMatchObject({ materialized: 0, failed: 1 });
        expect(mockModel.updateOne).not.toHaveBeenCalled();
      });

      // Resume-where-it-stopped, the property the insert-first ordering buys.
      it('persists progress made before a mid-catch-up failure', async () => {
        transactionsService.materializeRecurring
          .mockResolvedValueOnce({ materialized: true, duplicate: false })
          .mockResolvedValueOnce({ materialized: true, duplicate: false })
          .mockRejectedValueOnce(new Error('write failed'));
        // Due May 1 with today Aug 15 → May, Jun, Jul, Aug; the third throws.
        scanReturns([scanDoc({ nextDate: new Date('2026-05-01T00:00:00Z') })]);

        const summary = await service.materializeDue(NOW);

        expect(summary).toMatchObject({ materialized: 2, failed: 1 });
        // Two advances persisted, so tomorrow resumes at July rather than
        // replaying May and June.
        expect(mockModel.updateOne).toHaveBeenCalledTimes(2);
        expect(advancedTo(1)).toEqual(new Date('2026-07-01T00:00:00Z'));
      });

      it('counts a failed advance as failed without losing earlier progress', async () => {
        mockModel.updateOne
          .mockReturnValueOnce(
            createChainable({ matchedCount: 1, modifiedCount: 1 }),
          )
          .mockImplementationOnce(() => {
            throw new Error('advance failed');
          });
        scanReturns([scanDoc({ nextDate: new Date('2026-06-01T00:00:00Z') })]);

        const summary = await service.materializeDue(NOW);

        // Exact, not a lower bound: "without losing earlier progress" is the
        // whole claim, and >= 1 would pass even if progress HAD been lost.
        // June advances; July posts and its advance throws.
        expect(summary).toMatchObject({ failed: 1, materialized: 2 });
      });

      it('keeps processing other schedules when one throws', async () => {
        const other = new Types.ObjectId('507f191e810c19729de860ff');
        transactionsService.materializeRecurring
          .mockRejectedValueOnce(new Error('write failed'))
          .mockResolvedValue({ materialized: true, duplicate: false });
        scanReturns([scanDoc(), scanDoc({ _id: other })]);

        const summary = await service.materializeDue(NOW);

        expect(summary).toMatchObject({ materialized: 1, failed: 1 });
      });
    });

    it('caps runaway catch-up and persists the progress it made', async () => {
      // Weekly since 2020 — hundreds of periods. The cap bounds one run's
      // blast radius; the next daily run continues from where this stopped.
      scanReturns([
        scanDoc({
          cadence: RecurringCadence.WEEKLY,
          nextDate: new Date('2020-01-01T00:00:00Z'),
          cadenceAnchorDay: 1,
        }),
      ]);

      const summary = await service.materializeDue(NOW);

      expect(transactionsService.materializeRecurring).toHaveBeenCalledTimes(
        60,
      );
      expect(summary).toMatchObject({ materialized: 60, capped: 1 });
      // Progress persisted, so tomorrow resumes rather than restarting.
      expect(advancedTo(59)).toEqual(new Date('2021-02-24T00:00:00Z'));
    });

    // Boundary cases for the cap. A schedule that legitimately finishes ON the
    // cap must not be reported capped — it would look permanently behind and
    // be re-scanned forever.
    describe('cap boundary', () => {
      // A weekly schedule with EXACTLY n due occurrences. The occurrence on
      // NOW itself is due, so n periods means starting (n-1) weeks back.
      const weeklyWithDuePeriods = (n: number) =>
        scanDoc({
          cadence: RecurringCadence.WEEKLY,
          nextDate: new Date(NOW.getTime() - (n - 1) * 7 * 86_400_000),
          cadenceAnchorDay: undefined,
        });

      it('does not report capped when exactly 60 periods are due', async () => {
        scanReturns([weeklyWithDuePeriods(60)]);

        const summary = await service.materializeDue(NOW);

        // Fully caught up ON the cap: it exits via "not due yet", not via the
        // cap, so it is not re-scanned tomorrow as though it were behind.
        expect(summary).toMatchObject({ materialized: 60, capped: 0 });
      });

      it('reports capped when 61 periods are due', async () => {
        scanReturns([weeklyWithDuePeriods(61)]);

        const summary = await service.materializeDue(NOW);

        expect(summary).toMatchObject({ materialized: 60, capped: 1 });
      });
    });

    it('reports a summary across several schedules', async () => {
      scanReturns([
        scanDoc(),
        scanDoc({
          _id: new Types.ObjectId('507f191e810c19729de860fe'),
          accountId: undefined,
        }),
      ]);

      const summary = await service.materializeDue(NOW);

      expect(summary).toMatchObject({
        scanned: 2,
        materialized: 1,
        skipped: 1,
      });
    });
  });
});
