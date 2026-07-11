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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecurringService,
        {
          provide: getModelToken(RecurringTransaction.name),
          useValue: mockModel,
        },
        { provide: AccountsService, useValue: accountsService },
        { provide: CategoriesService, useValue: categoriesService },
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
      expect(doc.tags).toEqual([]);
      expect(recSave).toHaveBeenCalledTimes(1);
    });

    it('omits memberId when the guard supplies none', async () => {
      await service.create(HOUSEHOLD_ID, '', validCreate());
      expect(mockModel.mock.calls[0][0].memberId).toBeUndefined();
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
    it('scopes to the household and sorts by nextDate ascending', async () => {
      const chain = createChainable([recDoc()]);
      mockModel.find.mockReturnValue(chain);

      const result = await service.findAll(HOUSEHOLD_ID, {});

      expect(mockModel.find).toHaveBeenCalledWith({
        householdId: new Types.ObjectId(HOUSEHOLD_ID),
      });
      expect(chain.sort).toHaveBeenCalledWith({ nextDate: 1 });
      expect(result).toHaveLength(1);
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
    it('deletes the household-owned schedule', async () => {
      mockModel.findById.mockReturnValue(createChainable(recDoc()));
      await service.remove(HOUSEHOLD_ID, REC_ID);
      expect(mockModel.deleteOne).toHaveBeenCalledWith({
        _id: new Types.ObjectId(REC_ID),
      });
    });

    it("404s when deleting another household's schedule", async () => {
      mockModel.findById.mockReturnValue(
        createChainable(
          recDoc({ householdId: new Types.ObjectId(OTHER_HOUSEHOLD_ID) }),
        ),
      );
      await expect(service.remove(HOUSEHOLD_ID, REC_ID)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockModel.deleteOne).not.toHaveBeenCalled();
    });
  });
});
