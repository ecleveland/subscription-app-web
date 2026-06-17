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

describe('CategoriesService', () => {
  let service: CategoriesService;
  let mockGroupModel: any;
  let mockCategoryModel: any;
  let mockHouseholdModel: any;
  let groupSave: jest.Mock;
  let categorySave: jest.Mock;

  beforeEach(async () => {
    groupSave = jest.fn().mockImplementation(function (this: any) {
      return Promise.resolve({ _id: new Types.ObjectId(), ...this });
    });
    categorySave = jest.fn().mockImplementation(function (this: any) {
      return Promise.resolve(this);
    });

    mockGroupModel = jest
      .fn()
      .mockImplementation((dto) => ({ ...dto, save: groupSave }));
    mockGroupModel.countDocuments = jest
      .fn()
      .mockReturnValue(createChainable(0));
    mockGroupModel.find = jest.fn().mockReturnValue(createChainable([]));

    mockCategoryModel = jest
      .fn()
      .mockImplementation((dto) => ({ ...dto, save: categorySave }));
    mockCategoryModel.find = jest.fn().mockReturnValue(createChainable([]));

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
  });

  afterEach(() => jest.clearAllMocks());

  describe('seedDefaultsForHousehold', () => {
    it('creates the full default group/category set when none exist', async () => {
      const created = await service.seedDefaultsForHousehold(HOUSEHOLD_ID);

      expect(created).toBe(TOTAL_DEFAULT_CATEGORIES);
      expect(mockGroupModel).toHaveBeenCalledTimes(
        DEFAULT_CATEGORY_GROUPS.length,
      );
      expect(mockCategoryModel).toHaveBeenCalledTimes(TOTAL_DEFAULT_CATEGORIES);
    });

    it('scopes every created group and category to the household', async () => {
      await service.seedDefaultsForHousehold(HOUSEHOLD_ID);

      for (const call of mockGroupModel.mock.calls) {
        expect(call[0].householdId.toString()).toBe(HOUSEHOLD_ID);
      }
      for (const call of mockCategoryModel.mock.calls) {
        expect(call[0].householdId.toString()).toBe(HOUSEHOLD_ID);
      }
    });

    it('assigns group sortOrder by definition order and marks income categories', async () => {
      await service.seedDefaultsForHousehold(HOUSEHOLD_ID);

      const firstGroup = mockGroupModel.mock.calls[0][0];
      expect(firstGroup.name).toBe('Income');
      expect(firstGroup.sortOrder).toBe(0);

      // Every Income-group category is flagged isIncome; expense categories are not.
      const incomeCategoryCount = mockCategoryModel.mock.calls.filter(
        (c: any[]) => c[0].isIncome === true,
      ).length;
      const expectedIncome = DEFAULT_CATEGORY_GROUPS.flatMap(
        (g) => g.categories,
      ).filter((c) => c.isIncome).length;
      expect(incomeCategoryCount).toBe(expectedIncome);
    });

    it('is idempotent: skips seeding when the household already has groups', async () => {
      mockGroupModel.countDocuments.mockReturnValue(createChainable(3));

      const created = await service.seedDefaultsForHousehold(HOUSEHOLD_ID);

      expect(created).toBe(0);
      expect(mockGroupModel).not.toHaveBeenCalled();
      expect(mockCategoryModel).not.toHaveBeenCalled();
    });
  });

  describe('listCategories', () => {
    it('excludes archived categories by default', async () => {
      await service.listCategories(HOUSEHOLD_ID);

      const filter = mockCategoryModel.find.mock.calls[0][0];
      expect(filter.householdId.toString()).toBe(HOUSEHOLD_ID);
      expect(filter.isArchived).toBe(false);
    });

    it('includes archived categories when requested', async () => {
      await service.listCategories(HOUSEHOLD_ID, true);

      const filter = mockCategoryModel.find.mock.calls[0][0];
      expect(filter.isArchived).toBeUndefined();
    });
  });

  describe('listGroups', () => {
    it('queries groups scoped to the household', async () => {
      await service.listGroups(HOUSEHOLD_ID);

      const filter = mockGroupModel.find.mock.calls[0][0];
      expect(filter.householdId.toString()).toBe(HOUSEHOLD_ID);
    });
  });

  describe('backfillDefaultCategories', () => {
    it('seeds only households that lack categories and counts them', async () => {
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

    it('returns 0 when there are no households', async () => {
      mockHouseholdModel.find.mockReturnValue(createChainable([]));

      const seeded = await service.backfillDefaultCategories();
      expect(seeded).toBe(0);
    });
  });
});
