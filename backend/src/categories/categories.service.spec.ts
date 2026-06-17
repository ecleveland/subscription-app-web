import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { CategoriesService } from './categories.service';
import { CategoryGroup } from './schemas/category-group.schema';
import { Category } from './schemas/category.schema';
import { Household } from '../households/schemas/household.schema';
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

function duplicateKeyError(): Error {
  return Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
}

describe('CategoriesService', () => {
  let service: CategoriesService;
  let mockGroupModel: any;
  let mockCategoryModel: any;
  let mockHouseholdModel: any;

  beforeEach(async () => {
    mockGroupModel = {
      // Default: every group upsert succeeds, echoing a fresh _id + the name.
      findOneAndUpdate: jest
        .fn()
        .mockImplementation((filter: any) =>
          createChainable({ _id: new Types.ObjectId(), name: filter.name }),
        ),
      findOne: jest.fn().mockReturnValue(createChainable(null)),
      find: jest.fn().mockReturnValue(createChainable([])),
    };

    mockCategoryModel = {
      // Default: every category upsert inserts a new row.
      updateOne: jest
        .fn()
        .mockReturnValue(createChainable({ upsertedCount: 1 })),
      find: jest.fn().mockReturnValue(createChainable([])),
    };

    mockHouseholdModel = {
      find: jest.fn().mockReturnValue(createChainable([])),
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
      ],
    }).compile();

    module.useLogger(false);
    service = module.get<CategoriesService>(CategoriesService);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
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
  });
});
