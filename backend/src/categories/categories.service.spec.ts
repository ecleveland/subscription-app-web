import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { CategoriesService } from './categories.service';
import { CategoryGroup } from './schemas/category-group.schema';
import { Category } from './schemas/category.schema';
import { Household } from '../households/schemas/household.schema';
import { Transaction } from '../transactions/schemas/transaction.schema';
import { BudgetCategory } from '../budgets/schemas/budget-category.schema';
import { DEFAULT_CATEGORY_GROUPS } from './default-categories';

const HOUSEHOLD_ID = '507f191e810c19729de860ea';

const TOTAL_DEFAULT_CATEGORIES = DEFAULT_CATEGORY_GROUPS.reduce(
  (sum, g) => sum + g.categories.length,
  0,
);

function createChainable(resolvedValue: any = null) {
  const chain: any = {};
  chain.select = jest.fn().mockReturnValue(chain);
  chain.sort = jest.fn().mockReturnValue(chain);
  chain.exec = jest.fn().mockResolvedValue(resolvedValue);
  return chain;
}

function rejectingChainable(error: unknown) {
  const chain: any = {};
  chain.select = jest.fn().mockReturnValue(chain);
  chain.sort = jest.fn().mockReturnValue(chain);
  chain.exec = jest.fn().mockRejectedValue(error);
  return chain;
}

function duplicateKeyError(
  keyPattern: Record<string, number> = { householdId: 1, groupId: 1, name: 1 },
): Error {
  return Object.assign(new Error('E11000 duplicate key'), {
    code: 11000,
    keyPattern,
  });
}

describe('CategoriesService', () => {
  let service: CategoriesService;
  let mockGroupModel: any;
  let mockCategoryModel: any;
  let mockHouseholdModel: any;
  let mockTransactionModel: any;
  let mockBudgetCategoryModel: any;
  // save() mocks for documents built via `new this.model({...})` (the create
  // paths); constructed docs echo their fields plus a fresh _id.
  let categorySave: jest.Mock;
  let groupSave: jest.Mock;
  let errorLogSpy: jest.SpyInstance;

  beforeEach(async () => {
    categorySave = jest.fn().mockImplementation(function (this: any) {
      return Promise.resolve({ _id: new Types.ObjectId(), ...this });
    });
    groupSave = jest.fn().mockImplementation(function (this: any) {
      return Promise.resolve({ _id: new Types.ObjectId(), ...this });
    });

    mockGroupModel = jest
      .fn()
      .mockImplementation((doc: any) => ({ ...doc, save: groupSave }));
    // Default: every group upsert succeeds, echoing a fresh _id + the name.
    mockGroupModel.findOneAndUpdate = jest
      .fn()
      .mockImplementation((filter: any) =>
        createChainable({ _id: new Types.ObjectId(), name: filter.name }),
      );
    mockGroupModel.findOne = jest.fn().mockReturnValue(createChainable(null));
    mockGroupModel.find = jest.fn().mockReturnValue(createChainable([]));
    mockGroupModel.countDocuments = jest
      .fn()
      .mockReturnValue(createChainable(0));
    mockGroupModel.bulkWrite = jest.fn().mockResolvedValue({});

    mockCategoryModel = jest
      .fn()
      .mockImplementation((doc: any) => ({ ...doc, save: categorySave }));
    // Default: every category upsert inserts a new row.
    mockCategoryModel.updateOne = jest
      .fn()
      .mockReturnValue(createChainable({ upsertedCount: 1 }));
    mockCategoryModel.find = jest.fn().mockReturnValue(createChainable([]));
    mockCategoryModel.findOne = jest
      .fn()
      .mockReturnValue(createChainable(null));
    mockCategoryModel.exists = jest.fn().mockReturnValue(createChainable(null));
    mockCategoryModel.countDocuments = jest
      .fn()
      .mockReturnValue(createChainable(0));
    mockCategoryModel.bulkWrite = jest.fn().mockResolvedValue({});

    mockHouseholdModel = {
      find: jest.fn().mockReturnValue(createChainable([])),
      updateOne: jest.fn().mockReturnValue(createChainable({})),
    };

    mockTransactionModel = {
      exists: jest.fn().mockReturnValue(createChainable(null)),
    };

    mockBudgetCategoryModel = {
      exists: jest.fn().mockReturnValue(createChainable(null)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoriesService,
        {
          provide: getModelToken(CategoryGroup.name),
          useValue: mockGroupModel,
        },
        { provide: getModelToken(Category.name), useValue: mockCategoryModel },
        {
          provide: getModelToken(Household.name),
          useValue: mockHouseholdModel,
        },
        {
          provide: getModelToken(Transaction.name),
          useValue: mockTransactionModel,
        },
        {
          provide: getModelToken(BudgetCategory.name),
          useValue: mockBudgetCategoryModel,
        },
      ],
    }).compile();

    module.useLogger(false);
    service = module.get<CategoriesService>(CategoriesService);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    errorLogSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => jest.clearAllMocks());

  describe('seedDefaultsForHousehold', () => {
    it('upserts the full default group/category set when none exist', async () => {
      const created = await service.seedDefaultsForHousehold(HOUSEHOLD_ID);

      expect(created).toBe(TOTAL_DEFAULT_CATEGORIES);
      expect(mockGroupModel.findOneAndUpdate).toHaveBeenCalledTimes(
        DEFAULT_CATEGORY_GROUPS.length,
      );
      expect(mockCategoryModel.updateOne).toHaveBeenCalledTimes(
        TOTAL_DEFAULT_CATEGORIES,
      );
    });

    it('scopes every upserted group and category to the household', async () => {
      await service.seedDefaultsForHousehold(HOUSEHOLD_ID);

      for (const call of mockGroupModel.findOneAndUpdate.mock.calls) {
        expect(call[0].householdId.toString()).toBe(HOUSEHOLD_ID);
        expect(call[1].$setOnInsert.householdId.toString()).toBe(HOUSEHOLD_ID);
      }
      for (const call of mockCategoryModel.updateOne.mock.calls) {
        expect(call[0].householdId.toString()).toBe(HOUSEHOLD_ID);
      }
    });

    it('assigns group sortOrder by definition order and marks income categories', async () => {
      await service.seedDefaultsForHousehold(HOUSEHOLD_ID);

      const firstGroupUpdate = mockGroupModel.findOneAndUpdate.mock.calls[0];
      expect(firstGroupUpdate[0].name).toBe('Income');
      expect(firstGroupUpdate[1].$setOnInsert.sortOrder).toBe(0);

      const incomeCategoryCount = mockCategoryModel.updateOne.mock.calls.filter(
        (c: any[]) => c[1].$setOnInsert.isIncome === true,
      ).length;
      const expectedIncome = DEFAULT_CATEGORY_GROUPS.flatMap(
        (g) => g.categories,
      ).filter((c) => c.isIncome).length;
      expect(incomeCategoryCount).toBe(expectedIncome);
    });

    it('is idempotent: a fully-seeded household upserts nothing new', async () => {
      // Every group already exists (findOneAndUpdate matches, no insert) and
      // every category upsert reports upsertedCount 0.
      mockCategoryModel.updateOne.mockReturnValue(
        createChainable({ upsertedCount: 0 }),
      );

      const created = await service.seedDefaultsForHousehold(HOUSEHOLD_ID);

      expect(created).toBe(0);
      // Still attempts every upsert (that's what makes it self-repairing), but
      // creates nothing.
      expect(mockCategoryModel.updateOne).toHaveBeenCalledTimes(
        TOTAL_DEFAULT_CATEGORIES,
      );
    });

    it('self-repairs: counts only the categories actually inserted', async () => {
      // First category is missing (inserted), the rest already exist.
      mockCategoryModel.updateOne
        .mockReturnValueOnce(createChainable({ upsertedCount: 1 }))
        .mockReturnValue(createChainable({ upsertedCount: 0 }));

      const created = await service.seedDefaultsForHousehold(HOUSEHOLD_ID);
      expect(created).toBe(1);
    });

    it('ignores a duplicate-key race on a category upsert', async () => {
      mockCategoryModel.updateOne.mockReturnValueOnce(
        rejectingChainable(duplicateKeyError()),
      );

      // The losing racer treats the existing row as a benign no-op (not counted,
      // no throw); the remaining upserts proceed.
      const created = await service.seedDefaultsForHousehold(HOUSEHOLD_ID);
      expect(created).toBe(TOTAL_DEFAULT_CATEGORIES - 1);
    });

    it('re-reads the group when its upsert loses a duplicate-key race', async () => {
      const existingGroup = { _id: new Types.ObjectId(), name: 'Income' };
      mockGroupModel.findOneAndUpdate.mockReturnValueOnce(
        rejectingChainable(duplicateKeyError()),
      );
      mockGroupModel.findOne.mockReturnValueOnce(
        createChainable(existingGroup),
      );

      const created = await service.seedDefaultsForHousehold(HOUSEHOLD_ID);

      // Seeding continues past the race: the first group's categories are still
      // upserted against the re-read group id.
      expect(mockGroupModel.findOne).toHaveBeenCalledTimes(1);
      expect(created).toBe(TOTAL_DEFAULT_CATEGORIES);
      expect(mockCategoryModel.updateOne.mock.calls[0][0].groupId).toBe(
        existingGroup._id,
      );
    });

    it('throws a clear error when a dup-race group re-read finds nothing', async () => {
      mockGroupModel.findOneAndUpdate.mockReturnValueOnce(
        rejectingChainable(duplicateKeyError()),
      );
      mockGroupModel.findOne.mockReturnValueOnce(createChainable(null));

      await expect(
        service.seedDefaultsForHousehold(HOUSEHOLD_ID),
      ).rejects.toThrow(/could not be re-read/);
    });

    it('rethrows a non-duplicate error from a group upsert', async () => {
      mockGroupModel.findOneAndUpdate.mockReturnValueOnce(
        rejectingChainable(new Error('db down')),
      );

      await expect(
        service.seedDefaultsForHousehold(HOUSEHOLD_ID),
      ).rejects.toThrow('db down');
    });
  });

  describe('listCategories', () => {
    it('excludes archived categories by default and sorts by sortOrder', async () => {
      const chain = createChainable([]);
      mockCategoryModel.find.mockReturnValue(chain);

      await service.listCategories(HOUSEHOLD_ID);

      const filter = mockCategoryModel.find.mock.calls[0][0];
      expect(filter.householdId.toString()).toBe(HOUSEHOLD_ID);
      expect(filter.isArchived).toBe(false);
      expect(chain.sort).toHaveBeenCalledWith({ sortOrder: 1 });
    });

    it('includes archived categories when requested', async () => {
      await service.listCategories(HOUSEHOLD_ID, true);

      const filter = mockCategoryModel.find.mock.calls[0][0];
      expect(filter.isArchived).toBeUndefined();
    });
  });

  describe('listGroups', () => {
    it('queries groups scoped to the household, sorted by sortOrder', async () => {
      const chain = createChainable([]);
      mockGroupModel.find.mockReturnValue(chain);

      await service.listGroups(HOUSEHOLD_ID);

      const filter = mockGroupModel.find.mock.calls[0][0];
      expect(filter.householdId.toString()).toBe(HOUSEHOLD_ID);
      expect(chain.sort).toHaveBeenCalledWith({ sortOrder: 1 });
    });
  });

  describe('findInHousehold', () => {
    it('returns null for a malformed id without querying', async () => {
      const result = await service.findInHousehold(HOUSEHOLD_ID, 'not-an-id');
      expect(result).toBeNull();
      expect(mockCategoryModel.find).not.toHaveBeenCalled();
    });

    it('queries the category scoped to the household', async () => {
      const catId = new Types.ObjectId().toString();
      const doc = { _id: catId };
      mockCategoryModel.findOne = jest
        .fn()
        .mockReturnValue(createChainable(doc));

      const result = await service.findInHousehold(HOUSEHOLD_ID, catId);

      const filter = mockCategoryModel.findOne.mock.calls[0][0];
      expect(filter._id.toString()).toBe(catId);
      expect(filter.householdId.toString()).toBe(HOUSEHOLD_ID);
      expect(result).toBe(doc);
    });
  });

  describe('resolveImportCategories', () => {
    it('builds a lowercased name map and picks Miscellaneous as fallback', async () => {
      const groceries = new Types.ObjectId();
      const misc = new Types.ObjectId();
      mockCategoryModel.find.mockReturnValue(
        createChainable([
          { _id: groceries, name: 'Groceries', isIncome: false },
          { _id: misc, name: 'Miscellaneous', isIncome: false },
        ]),
      );

      const { byName, fallbackId } =
        await service.resolveImportCategories(HOUSEHOLD_ID);

      expect(byName.get('groceries')).toBe(groceries);
      expect(fallbackId).toBe(misc);
    });

    it('falls back to an expense category when Miscellaneous is absent', async () => {
      const income = new Types.ObjectId();
      const expense = new Types.ObjectId();
      mockCategoryModel.find.mockReturnValue(
        createChainable([
          { _id: income, name: 'Paycheck', isIncome: true },
          { _id: expense, name: 'Rent', isIncome: false },
        ]),
      );

      const { fallbackId } =
        await service.resolveImportCategories(HOUSEHOLD_ID);
      expect(fallbackId).toBe(expense);
    });

    it('returns a null fallback when the household has no categories', async () => {
      mockCategoryModel.find.mockReturnValue(createChainable([]));
      const { fallbackId } =
        await service.resolveImportCategories(HOUSEHOLD_ID);
      expect(fallbackId).toBeNull();
    });
  });

  describe('backfillDefaultCategories', () => {
    it('seeds only households that gained categories and counts them', async () => {
      mockHouseholdModel.find.mockReturnValue(
        createChainable([
          { _id: new Types.ObjectId() },
          { _id: new Types.ObjectId() },
        ]),
      );
      const seedSpy = jest
        .spyOn(service, 'seedDefaultsForHousehold')
        .mockResolvedValueOnce(TOTAL_DEFAULT_CATEGORIES)
        .mockResolvedValueOnce(0);

      const seeded = await service.backfillDefaultCategories();

      expect(seedSpy).toHaveBeenCalledTimes(2);
      expect(seeded).toBe(1);
    });

    it('isolates per-household failures and continues the sweep', async () => {
      mockHouseholdModel.find.mockReturnValue(
        createChainable([
          { _id: new Types.ObjectId() },
          { _id: new Types.ObjectId() },
          { _id: new Types.ObjectId() },
        ]),
      );
      const seedSpy = jest
        .spyOn(service, 'seedDefaultsForHousehold')
        .mockRejectedValueOnce(new Error('poison household'))
        .mockResolvedValueOnce(TOTAL_DEFAULT_CATEGORIES)
        .mockResolvedValueOnce(0);

      const seeded = await service.backfillDefaultCategories();

      // The first household's failure doesn't abort the sweep; the other two are
      // still processed and the successful one is counted.
      expect(seedSpy).toHaveBeenCalledTimes(3);
      expect(seeded).toBe(1);
    });

    it('returns 0 when there are no households', async () => {
      mockHouseholdModel.find.mockReturnValue(createChainable([]));

      const seeded = await service.backfillDefaultCategories();
      expect(seeded).toBe(0);
    });

    it('enumerates only households without the seeded stamp', async () => {
      mockHouseholdModel.find.mockReturnValue(createChainable([]));

      await service.backfillDefaultCategories();

      expect(mockHouseholdModel.find).toHaveBeenCalledWith({
        defaultCategoriesSeededAt: { $exists: false },
      });
    });
  });

  describe('seeding stamp', () => {
    it('stamps the household after a fully successful seed', async () => {
      await service.seedDefaultsForHousehold(HOUSEHOLD_ID);

      expect(mockHouseholdModel.updateOne).toHaveBeenCalledTimes(1);
      const [filter, update] = mockHouseholdModel.updateOne.mock.calls[0];
      expect(filter._id.toString()).toBe(HOUSEHOLD_ID);
      expect(update.$set.defaultCategoriesSeededAt).toBeInstanceOf(Date);
    });

    it('does not stamp a household whose seed aborts mid-pass', async () => {
      mockGroupModel.findOneAndUpdate.mockReturnValueOnce(
        rejectingChainable(new Error('db down')),
      );

      await expect(
        service.seedDefaultsForHousehold(HOUSEHOLD_ID),
      ).rejects.toThrow('db down');
      expect(mockHouseholdModel.updateOne).not.toHaveBeenCalled();
    });
  });

  describe('createCategory', () => {
    function givenGroupInHousehold(groupId = new Types.ObjectId()) {
      mockGroupModel.findOne.mockReturnValue(
        createChainable({ _id: groupId, name: 'Food' }),
      );
      return groupId;
    }

    it('creates a household-scoped category with appended sortOrder', async () => {
      const groupId = givenGroupInHousehold();
      // Highest existing sortOrder in the group is 4 → new category gets 5.
      mockCategoryModel.findOne.mockReturnValue(
        createChainable({ sortOrder: 4 }),
      );

      const result = await service.createCategory(HOUSEHOLD_ID, {
        name: 'Coffee',
        groupId: groupId.toString(),
      });

      const groupFilter = mockGroupModel.findOne.mock.calls[0][0];
      expect(groupFilter._id.toString()).toBe(groupId.toString());
      expect(groupFilter.householdId.toString()).toBe(HOUSEHOLD_ID);
      const doc = mockCategoryModel.mock.calls[0][0];
      expect(doc.householdId.toString()).toBe(HOUSEHOLD_ID);
      expect(doc.groupId.toString()).toBe(groupId.toString());
      expect(doc.name).toBe('Coffee');
      expect(doc.isIncome).toBe(false);
      expect(doc.sortOrder).toBe(5);
      expect(categorySave).toHaveBeenCalledTimes(1);
      expect(result.name).toBe('Coffee');
    });

    it('starts sortOrder at 0 in an empty group and honors isIncome', async () => {
      const groupId = givenGroupInHousehold();
      mockCategoryModel.findOne.mockReturnValue(createChainable(null));

      await service.createCategory(HOUSEHOLD_ID, {
        name: 'Bonus',
        groupId: groupId.toString(),
        isIncome: true,
      });

      const doc = mockCategoryModel.mock.calls[0][0];
      expect(doc.sortOrder).toBe(0);
      expect(doc.isIncome).toBe(true);
    });

    it('honors an explicit sortOrder without querying for the max', async () => {
      const groupId = givenGroupInHousehold();

      await service.createCategory(HOUSEHOLD_ID, {
        name: 'Coffee',
        groupId: groupId.toString(),
        sortOrder: 7,
      });

      expect(mockCategoryModel.findOne).not.toHaveBeenCalled();
      expect(mockCategoryModel.mock.calls[0][0].sortOrder).toBe(7);
    });

    it('rejects a group that is not in the household', async () => {
      mockGroupModel.findOne.mockReturnValue(createChainable(null));

      await expect(
        service.createCategory(HOUSEHOLD_ID, {
          name: 'Coffee',
          groupId: new Types.ObjectId().toString(),
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockCategoryModel).not.toHaveBeenCalled();
    });

    it('maps a duplicate name in the group to a conflict', async () => {
      const groupId = givenGroupInHousehold();
      categorySave.mockRejectedValue(duplicateKeyError());

      await expect(
        service.createCategory(HOUSEHOLD_ID, {
          name: 'Groceries',
          groupId: groupId.toString(),
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('does not mislabel a non-name unique-index violation as a name conflict', async () => {
      const groupId = givenGroupInHousehold();
      categorySave.mockRejectedValue(duplicateKeyError({ someFutureField: 1 }));

      await expect(
        service.createCategory(HOUSEHOLD_ID, {
          name: 'Groceries',
          groupId: groupId.toString(),
        }),
      ).rejects.toThrow('E11000 duplicate key');
    });
  });

  describe('updateCategory', () => {
    function mockCategoryDoc(overrides: Record<string, any> = {}) {
      const doc: any = {
        _id: new Types.ObjectId(),
        householdId: new Types.ObjectId(HOUSEHOLD_ID),
        groupId: new Types.ObjectId(),
        name: 'Groceries',
        isIncome: false,
        sortOrder: 0,
        isArchived: false,
        ...overrides,
      };
      doc.save = jest.fn().mockResolvedValue(doc);
      doc.deleteOne = jest.fn().mockResolvedValue({});
      return doc;
    }

    it('404s when the category is missing or foreign', async () => {
      mockCategoryModel.findOne.mockReturnValue(createChainable(null));

      await expect(
        service.updateCategory(HOUSEHOLD_ID, new Types.ObjectId().toString(), {
          name: 'New name',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('scopes the lookup to the household', async () => {
      const doc = mockCategoryDoc();
      mockCategoryModel.findOne.mockReturnValue(createChainable(doc));

      await service.updateCategory(HOUSEHOLD_ID, doc._id.toString(), {});

      const filter = mockCategoryModel.findOne.mock.calls[0][0];
      expect(filter._id.toString()).toBe(doc._id.toString());
      expect(filter.householdId.toString()).toBe(HOUSEHOLD_ID);
    });

    it('renames, reorders and archives via save', async () => {
      const doc = mockCategoryDoc();
      mockCategoryModel.findOne.mockReturnValue(createChainable(doc));

      const result = await service.updateCategory(
        HOUSEHOLD_ID,
        doc._id.toString(),
        { name: 'Renamed', sortOrder: 3, isArchived: true },
      );

      expect(doc.name).toBe('Renamed');
      expect(doc.sortOrder).toBe(3);
      expect(doc.isArchived).toBe(true);
      expect(doc.save).toHaveBeenCalledTimes(1);
      expect(result).toBe(doc);
    });

    it('supports un-archiving', async () => {
      const doc = mockCategoryDoc({ isArchived: true });
      mockCategoryModel.findOne.mockReturnValue(createChainable(doc));

      await service.updateCategory(HOUSEHOLD_ID, doc._id.toString(), {
        isArchived: false,
      });

      expect(doc.isArchived).toBe(false);
      expect(doc.save).toHaveBeenCalledTimes(1);
    });

    it('validates the target group when moving and rejects a foreign one', async () => {
      const doc = mockCategoryDoc();
      mockCategoryModel.findOne.mockReturnValue(createChainable(doc));
      mockGroupModel.findOne.mockReturnValue(createChainable(null));

      await expect(
        service.updateCategory(HOUSEHOLD_ID, doc._id.toString(), {
          groupId: new Types.ObjectId().toString(),
        }),
      ).rejects.toThrow(BadRequestException);
      expect(doc.save).not.toHaveBeenCalled();
    });

    it('moves to a validated group in the household', async () => {
      const doc = mockCategoryDoc();
      const targetGroupId = new Types.ObjectId();
      mockCategoryModel.findOne.mockReturnValue(createChainable(doc));
      mockGroupModel.findOne.mockReturnValue(
        createChainable({ _id: targetGroupId }),
      );

      await service.updateCategory(HOUSEHOLD_ID, doc._id.toString(), {
        groupId: targetGroupId.toString(),
      });

      expect(doc.groupId.toString()).toBe(targetGroupId.toString());
      expect(doc.save).toHaveBeenCalledTimes(1);
    });

    it('maps a rename collision to a conflict', async () => {
      const doc = mockCategoryDoc();
      doc.save = jest.fn().mockRejectedValue(duplicateKeyError());
      mockCategoryModel.findOne.mockReturnValue(createChainable(doc));

      await expect(
        service.updateCategory(HOUSEHOLD_ID, doc._id.toString(), {
          name: 'Groceries',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('removeCategory', () => {
    function mockCategoryDoc(overrides: Record<string, any> = {}) {
      const doc: any = {
        _id: new Types.ObjectId(),
        householdId: new Types.ObjectId(HOUSEHOLD_ID),
        isArchived: false,
        ...overrides,
      };
      doc.save = jest.fn().mockResolvedValue(doc);
      doc.deleteOne = jest.fn().mockResolvedValue({});
      return doc;
    }

    it('404s when the category is missing or foreign', async () => {
      mockCategoryModel.findOne.mockReturnValue(createChainable(null));

      await expect(
        service.removeCategory(HOUSEHOLD_ID, new Types.ObjectId().toString()),
      ).rejects.toThrow(NotFoundException);
    });

    it('archives a category referenced by a transaction', async () => {
      const doc = mockCategoryDoc();
      mockCategoryModel.findOne.mockReturnValue(createChainable(doc));
      mockTransactionModel.exists.mockReturnValue(
        createChainable({ _id: new Types.ObjectId() }),
      );

      const result = await service.removeCategory(
        HOUSEHOLD_ID,
        doc._id.toString(),
      );

      expect(result).toEqual({ outcome: 'archived' });
      expect(doc.isArchived).toBe(true);
      expect(doc.save).toHaveBeenCalledTimes(1);
      expect(doc.deleteOne).not.toHaveBeenCalled();
      const txnFilter = mockTransactionModel.exists.mock.calls[0][0];
      expect(txnFilter.householdId.toString()).toBe(HOUSEHOLD_ID);
      expect(txnFilter.categoryId.toString()).toBe(doc._id.toString());
    });

    it('archives a category referenced only by a budget row', async () => {
      const doc = mockCategoryDoc();
      mockCategoryModel.findOne.mockReturnValue(createChainable(doc));
      mockBudgetCategoryModel.exists.mockReturnValue(
        createChainable({ _id: new Types.ObjectId() }),
      );

      const result = await service.removeCategory(
        HOUSEHOLD_ID,
        doc._id.toString(),
      );

      expect(result).toEqual({ outcome: 'archived' });
      expect(doc.deleteOne).not.toHaveBeenCalled();
      const filter = mockBudgetCategoryModel.exists.mock.calls[0][0];
      expect(filter.categoryId.toString()).toBe(doc._id.toString());
    });

    it('hard-deletes an unreferenced category', async () => {
      const doc = mockCategoryDoc();
      mockCategoryModel.findOne.mockReturnValue(createChainable(doc));

      const result = await service.removeCategory(
        HOUSEHOLD_ID,
        doc._id.toString(),
      );

      expect(result).toEqual({ outcome: 'deleted' });
      expect(doc.deleteOne).toHaveBeenCalledTimes(1);
      expect(doc.save).not.toHaveBeenCalled();
    });

    it('re-archiving an already-archived referenced category is a no-op save', async () => {
      const doc = mockCategoryDoc({ isArchived: true });
      mockCategoryModel.findOne.mockReturnValue(createChainable(doc));
      mockTransactionModel.exists.mockReturnValue(
        createChainable({ _id: new Types.ObjectId() }),
      );

      const result = await service.removeCategory(
        HOUSEHOLD_ID,
        doc._id.toString(),
      );

      expect(result).toEqual({ outcome: 'archived' });
      // Already archived: no redundant write.
      expect(doc.save).not.toHaveBeenCalled();
      expect(doc.deleteOne).not.toHaveBeenCalled();
    });

    it('hard-deletes an archived category once nothing references it', async () => {
      const doc = mockCategoryDoc({ isArchived: true });
      mockCategoryModel.findOne.mockReturnValue(createChainable(doc));

      const result = await service.removeCategory(
        HOUSEHOLD_ID,
        doc._id.toString(),
      );

      expect(result).toEqual({ outcome: 'deleted' });
      expect(doc.deleteOne).toHaveBeenCalledTimes(1);
    });
  });

  describe('reorderCategories', () => {
    function householdCategories(count: number) {
      return Array.from({ length: count }, (_, i) => ({
        _id: new Types.ObjectId(),
        sortOrder: i,
      }));
    }

    it('rejects the whole batch when any id is foreign, writing nothing', async () => {
      const owned = householdCategories(2);
      // Only 1 of the 2 submitted ids is owned by the household.
      mockCategoryModel.countDocuments.mockReturnValue(createChainable(1));

      await expect(
        service.reorderCategories(HOUSEHOLD_ID, [
          owned[0]._id.toString(),
          new Types.ObjectId().toString(),
        ]),
      ).rejects.toThrow(BadRequestException);
      expect(mockCategoryModel.bulkWrite).not.toHaveBeenCalled();
    });

    it('validates ownership by count, scoped to the household, archived included', async () => {
      const owned = householdCategories(2);
      mockCategoryModel.countDocuments.mockReturnValue(createChainable(2));

      await service.reorderCategories(HOUSEHOLD_ID, [
        owned[1]._id.toString(),
        owned[0]._id.toString(),
      ]);

      const filter = mockCategoryModel.countDocuments.mock.calls[0][0];
      expect(filter.householdId.toString()).toBe(HOUSEHOLD_ID);
      expect(filter._id.$in).toHaveLength(2);
      // Archived categories must stay reorderable: no isArchived filter.
      expect(filter.isArchived).toBeUndefined();
    });

    it('bulk-writes sortOrder = array index with household-scoped filters', async () => {
      const owned = householdCategories(3);
      mockCategoryModel.countDocuments.mockReturnValue(createChainable(3));
      mockCategoryModel.find.mockReturnValue(createChainable(owned));

      const result = await service.reorderCategories(HOUSEHOLD_ID, [
        owned[2]._id.toString(),
        owned[0]._id.toString(),
        owned[1]._id.toString(),
      ]);

      expect(mockCategoryModel.bulkWrite).toHaveBeenCalledTimes(1);
      const ops = mockCategoryModel.bulkWrite.mock.calls[0][0];
      expect(ops).toHaveLength(3);
      ops.forEach((op: any, index: number) => {
        expect(op.updateOne.filter.householdId.toString()).toBe(HOUSEHOLD_ID);
        expect(op.updateOne.update.$set.sortOrder).toBe(index);
      });
      expect(ops[0].updateOne.filter._id.toString()).toBe(
        owned[2]._id.toString(),
      );
      // Returns the refreshed list (the household-scoped read after writing).
      expect(mockCategoryModel.find).toHaveBeenCalledTimes(1);
      expect(result).toBe(owned);
    });

    it('logs and rethrows a mid-batch bulkWrite failure', async () => {
      const owned = householdCategories(1);
      mockCategoryModel.countDocuments.mockReturnValue(createChainable(1));
      mockCategoryModel.bulkWrite.mockRejectedValue(new Error('write failed'));

      await expect(
        service.reorderCategories(HOUSEHOLD_ID, [owned[0]._id.toString()]),
      ).rejects.toThrow('write failed');
      expect(errorLogSpy).toHaveBeenCalled();
    });
  });

  describe('reorderGroups', () => {
    function householdGroups(count: number) {
      return Array.from({ length: count }, (_, i) => ({
        _id: new Types.ObjectId(),
        sortOrder: i,
      }));
    }

    it('rejects the whole batch when any id is foreign, writing nothing', async () => {
      const owned = householdGroups(2);
      // Only 1 of the 2 submitted ids is owned by the household.
      mockGroupModel.countDocuments.mockReturnValue(createChainable(1));

      await expect(
        service.reorderGroups(HOUSEHOLD_ID, [
          owned[0]._id.toString(),
          new Types.ObjectId().toString(),
        ]),
      ).rejects.toThrow(BadRequestException);
      expect(mockGroupModel.bulkWrite).not.toHaveBeenCalled();
    });

    it('validates ownership by count, scoped to the household', async () => {
      const owned = householdGroups(2);
      mockGroupModel.countDocuments.mockReturnValue(createChainable(2));

      await service.reorderGroups(HOUSEHOLD_ID, [
        owned[1]._id.toString(),
        owned[0]._id.toString(),
      ]);

      const filter = mockGroupModel.countDocuments.mock.calls[0][0];
      expect(filter.householdId.toString()).toBe(HOUSEHOLD_ID);
      expect(filter._id.$in).toHaveLength(2);
    });

    it('bulk-writes sortOrder = array index with household-scoped filters', async () => {
      const owned = householdGroups(3);
      mockGroupModel.countDocuments.mockReturnValue(createChainable(3));
      mockGroupModel.find.mockReturnValue(createChainable(owned));

      const result = await service.reorderGroups(HOUSEHOLD_ID, [
        owned[2]._id.toString(),
        owned[0]._id.toString(),
        owned[1]._id.toString(),
      ]);

      expect(mockGroupModel.bulkWrite).toHaveBeenCalledTimes(1);
      const ops = mockGroupModel.bulkWrite.mock.calls[0][0];
      expect(ops).toHaveLength(3);
      ops.forEach((op: any, index: number) => {
        expect(op.updateOne.filter.householdId.toString()).toBe(HOUSEHOLD_ID);
        expect(op.updateOne.update.$set.sortOrder).toBe(index);
      });
      expect(ops[0].updateOne.filter._id.toString()).toBe(
        owned[2]._id.toString(),
      );
      // Returns the refreshed group list (household-scoped read after writing).
      expect(mockGroupModel.find).toHaveBeenCalledTimes(1);
      expect(result).toBe(owned);
    });

    it('allows a partial list (unlisted groups keep their sortOrder)', async () => {
      const owned = householdGroups(1);
      mockGroupModel.countDocuments.mockReturnValue(createChainable(1));

      await service.reorderGroups(HOUSEHOLD_ID, [owned[0]._id.toString()]);

      expect(mockGroupModel.bulkWrite).toHaveBeenCalledTimes(1);
      expect(mockGroupModel.bulkWrite.mock.calls[0][0]).toHaveLength(1);
    });

    it('logs and rethrows a mid-batch bulkWrite failure', async () => {
      const owned = householdGroups(1);
      mockGroupModel.countDocuments.mockReturnValue(createChainable(1));
      mockGroupModel.bulkWrite.mockRejectedValue(new Error('write failed'));

      await expect(
        service.reorderGroups(HOUSEHOLD_ID, [owned[0]._id.toString()]),
      ).rejects.toThrow('write failed');
      expect(errorLogSpy).toHaveBeenCalled();
    });
  });

  describe('createGroup', () => {
    it('creates a household-scoped group with appended sortOrder', async () => {
      // Highest existing group sortOrder is 6 → new group gets 7.
      mockGroupModel.findOne.mockReturnValue(createChainable({ sortOrder: 6 }));

      const result = await service.createGroup(HOUSEHOLD_ID, { name: 'Pets' });

      const doc = mockGroupModel.mock.calls[0][0];
      expect(doc.householdId.toString()).toBe(HOUSEHOLD_ID);
      expect(doc.name).toBe('Pets');
      expect(doc.sortOrder).toBe(7);
      expect(groupSave).toHaveBeenCalledTimes(1);
      expect(result.name).toBe('Pets');
    });

    it('honors an explicit sortOrder', async () => {
      await service.createGroup(HOUSEHOLD_ID, { name: 'Pets', sortOrder: 2 });

      expect(mockGroupModel.findOne).not.toHaveBeenCalled();
      expect(mockGroupModel.mock.calls[0][0].sortOrder).toBe(2);
    });

    it('maps a duplicate group name to a conflict', async () => {
      mockGroupModel.findOne.mockReturnValue(createChainable(null));
      groupSave.mockRejectedValue(duplicateKeyError());

      await expect(
        service.createGroup(HOUSEHOLD_ID, { name: 'Housing' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('updateGroup', () => {
    function mockGroupDoc(overrides: Record<string, any> = {}) {
      const doc: any = {
        _id: new Types.ObjectId(),
        householdId: new Types.ObjectId(HOUSEHOLD_ID),
        name: 'Housing',
        sortOrder: 0,
        ...overrides,
      };
      doc.save = jest.fn().mockResolvedValue(doc);
      doc.deleteOne = jest.fn().mockResolvedValue({});
      return doc;
    }

    it('404s when the group is missing or foreign', async () => {
      mockGroupModel.findOne.mockReturnValue(createChainable(null));

      await expect(
        service.updateGroup(HOUSEHOLD_ID, new Types.ObjectId().toString(), {
          name: 'New',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('renames and reorders via save, scoped to the household', async () => {
      const doc = mockGroupDoc();
      mockGroupModel.findOne.mockReturnValue(createChainable(doc));

      const result = await service.updateGroup(
        HOUSEHOLD_ID,
        doc._id.toString(),
        { name: 'Shelter', sortOrder: 4 },
      );

      const filter = mockGroupModel.findOne.mock.calls[0][0];
      expect(filter.householdId.toString()).toBe(HOUSEHOLD_ID);
      expect(doc.name).toBe('Shelter');
      expect(doc.sortOrder).toBe(4);
      expect(doc.save).toHaveBeenCalledTimes(1);
      expect(result).toBe(doc);
    });

    it('maps a rename collision to a conflict', async () => {
      const doc = mockGroupDoc();
      doc.save = jest.fn().mockRejectedValue(duplicateKeyError());
      mockGroupModel.findOne.mockReturnValue(createChainable(doc));

      await expect(
        service.updateGroup(HOUSEHOLD_ID, doc._id.toString(), {
          name: 'Food',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('removeGroup', () => {
    function mockGroupDoc() {
      const doc: any = {
        _id: new Types.ObjectId(),
        householdId: new Types.ObjectId(HOUSEHOLD_ID),
        name: 'Housing',
      };
      doc.deleteOne = jest.fn().mockResolvedValue({});
      return doc;
    }

    it('404s when the group is missing or foreign', async () => {
      mockGroupModel.findOne.mockReturnValue(createChainable(null));

      await expect(
        service.removeGroup(HOUSEHOLD_ID, new Types.ObjectId().toString()),
      ).rejects.toThrow(NotFoundException);
    });

    it('blocks deletion while the group contains categories (archived count)', async () => {
      const doc = mockGroupDoc();
      mockGroupModel.findOne.mockReturnValue(createChainable(doc));
      mockCategoryModel.exists.mockReturnValue(
        createChainable({ _id: new Types.ObjectId() }),
      );

      await expect(
        service.removeGroup(HOUSEHOLD_ID, doc._id.toString()),
      ).rejects.toThrow(ConflictException);
      expect(doc.deleteOne).not.toHaveBeenCalled();
      const filter = mockCategoryModel.exists.mock.calls[0][0];
      expect(filter.householdId.toString()).toBe(HOUSEHOLD_ID);
      expect(filter.groupId.toString()).toBe(doc._id.toString());
      expect(filter.isArchived).toBeUndefined();
    });

    it('hard-deletes an empty group', async () => {
      const doc = mockGroupDoc();
      mockGroupModel.findOne.mockReturnValue(createChainable(doc));
      mockCategoryModel.exists.mockReturnValue(createChainable(null));

      await service.removeGroup(HOUSEHOLD_ID, doc._id.toString());

      expect(doc.deleteOne).toHaveBeenCalledTimes(1);
    });
  });
});
