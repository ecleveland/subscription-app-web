import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { GoalsService } from './goals.service';
import { Goal, GoalType } from './schemas/goal.schema';
import { CategoriesService } from '../categories/categories.service';

const HH = '507f191e810c19729de860ea';
const OTHER_HH = '507f191e810c19729de860eb';
const GOAL_ID = '507f191e810c19729de86001';
const CAT_ID = '507f191e810c19729de86011';

function createChainable(resolvedValue: any = null) {
  const chain: any = {};
  chain.sort = jest.fn().mockReturnValue(chain);
  chain.exec = jest.fn().mockResolvedValue(resolvedValue);
  return chain;
}

// A hydrated goal document as findById returns it.
function goalDoc(overrides: Record<string, unknown> = {}) {
  const doc: any = {
    _id: new Types.ObjectId(GOAL_ID),
    householdId: new Types.ObjectId(HH),
    name: 'Emergency fund',
    type: GoalType.SAVINGS,
    targetCents: 100000,
    currentCents: 2500,
    isArchived: false,
    ...overrides,
  };
  doc.set = jest.fn((key: string, value: unknown) => {
    doc[key] = value;
  });
  doc.save = jest.fn().mockResolvedValue(doc);
  return doc;
}

describe('GoalsService', () => {
  let service: GoalsService;
  let goalModel: any;
  let categoriesService: { findInHousehold: jest.Mock };
  let constructed: any[];

  beforeEach(async () => {
    constructed = [];
    // The model doubles as a constructor (create) and a query surface.
    goalModel = jest
      .fn()
      .mockImplementation((data: Record<string, unknown>) => {
        const doc = { ...data, save: jest.fn() };
        doc.save.mockResolvedValue({
          _id: new Types.ObjectId(GOAL_ID),
          ...data,
        });
        constructed.push(doc);
        return doc;
      });
    goalModel.find = jest.fn().mockReturnValue(createChainable([]));
    goalModel.findById = jest.fn().mockReturnValue(createChainable(null));
    goalModel.findOneAndUpdate = jest
      .fn()
      .mockReturnValue(createChainable(null));
    goalModel.deleteOne = jest
      .fn()
      .mockReturnValue(createChainable({ deletedCount: 1 }));

    categoriesService = {
      findInHousehold: jest
        .fn()
        .mockResolvedValue({ _id: new Types.ObjectId(CAT_ID) }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoalsService,
        { provide: getModelToken(Goal.name), useValue: goalModel },
        { provide: CategoriesService, useValue: categoriesService },
      ],
    }).compile();

    service = module.get<GoalsService>(GoalsService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('create', () => {
    it('defaults currentCents to 0 and isArchived to false', async () => {
      await service.create(HH, {
        name: 'Emergency fund',
        type: GoalType.SAVINGS,
        targetCents: 100000,
      });
      expect(constructed).toHaveLength(1);
      expect(constructed[0].currentCents).toBe(0);
      expect(constructed[0].isArchived).toBe(false);
      expect(constructed[0].householdId).toEqual(new Types.ObjectId(HH));
      expect(constructed[0].save).toHaveBeenCalled();
    });

    it('ignores a currentCents smuggled into the body', async () => {
      await service.create(HH, {
        name: 'Car',
        type: GoalType.SAVINGS,
        targetCents: 500,
        currentCents: 999,
      } as any);
      expect(constructed[0].currentCents).toBe(0);
    });

    it('stores a validated categoryId and a UTC target date', async () => {
      await service.create(HH, {
        name: 'Vacation',
        type: GoalType.SAVINGS,
        targetCents: 300000,
        categoryId: CAT_ID,
        targetDate: '2027-06-01',
      });
      expect(categoriesService.findInHousehold).toHaveBeenCalledWith(
        HH,
        CAT_ID,
      );
      expect(constructed[0].categoryId).toEqual(new Types.ObjectId(CAT_ID));
      expect(constructed[0].targetDate).toEqual(
        new Date('2027-06-01T00:00:00Z'),
      );
    });

    it('rejects a category from another household with 400', async () => {
      categoriesService.findInHousehold.mockResolvedValue(null);
      await expect(
        service.create(HH, {
          name: 'Vacation',
          type: GoalType.SAVINGS,
          targetCents: 300000,
          categoryId: CAT_ID,
        }),
      ).rejects.toThrow(
        new BadRequestException(
          'categoryId does not reference a category in this household',
        ),
      );
      expect(constructed).toHaveLength(0);
    });
  });

  describe('findAll', () => {
    it('excludes archived goals by default', async () => {
      await service.findAll(HH);
      expect(goalModel.find).toHaveBeenCalledWith({
        householdId: new Types.ObjectId(HH),
        isArchived: false,
      });
    });

    it('includes archived goals when includeArchived is true', async () => {
      await service.findAll(HH, true);
      expect(goalModel.find).toHaveBeenCalledWith({
        householdId: new Types.ObjectId(HH),
      });
    });
  });

  describe('findOne', () => {
    it('returns a goal in the household', async () => {
      const doc = goalDoc();
      goalModel.findById.mockReturnValue(createChainable(doc));
      await expect(service.findOne(HH, GOAL_ID)).resolves.toBe(doc);
    });

    it('404s for a goal in another household', async () => {
      goalModel.findById.mockReturnValue(
        createChainable(goalDoc({ householdId: new Types.ObjectId(OTHER_HH) })),
      );
      await expect(service.findOne(HH, GOAL_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('404s for a malformed id without querying', async () => {
      await expect(service.findOne(HH, 'nope')).rejects.toThrow(
        NotFoundException,
      );
      expect(goalModel.findById).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('ignores currentCents even if present', async () => {
      const doc = goalDoc();
      goalModel.findById.mockReturnValue(createChainable(doc));
      await service.update(HH, GOAL_ID, {
        name: 'Renamed',
        currentCents: 999999,
      } as any);
      expect(doc.name).toBe('Renamed');
      expect(doc.currentCents).toBe(2500);
      expect(doc.save).toHaveBeenCalled();
    });

    it('clears targetDate and categoryId on null', async () => {
      const doc = goalDoc({
        targetDate: new Date('2027-01-01'),
        categoryId: new Types.ObjectId(CAT_ID),
      });
      goalModel.findById.mockReturnValue(createChainable(doc));
      await service.update(HH, GOAL_ID, { targetDate: null, categoryId: null });
      expect(doc.targetDate).toBeUndefined();
      expect(doc.categoryId).toBeUndefined();
      expect(categoriesService.findInHousehold).not.toHaveBeenCalled();
    });

    it('rejects a category from another household with 400', async () => {
      const doc = goalDoc();
      goalModel.findById.mockReturnValue(createChainable(doc));
      categoriesService.findInHousehold.mockResolvedValue(null);
      await expect(
        service.update(HH, GOAL_ID, { categoryId: CAT_ID }),
      ).rejects.toThrow(BadRequestException);
      expect(doc.save).not.toHaveBeenCalled();
    });

    it('archives a goal', async () => {
      const doc = goalDoc();
      goalModel.findById.mockReturnValue(createChainable(doc));
      await service.update(HH, GOAL_ID, { isArchived: true });
      expect(doc.isArchived).toBe(true);
    });

    it('404s for a goal in another household', async () => {
      goalModel.findById.mockReturnValue(
        createChainable(goalDoc({ householdId: new Types.ObjectId(OTHER_HH) })),
      );
      await expect(service.update(HH, GOAL_ID, { name: 'x' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('addContribution', () => {
    it('issues a single household-scoped $inc and returns the updated goal', async () => {
      const updated = goalDoc({ currentCents: 7500 });
      goalModel.findOneAndUpdate.mockReturnValue(createChainable(updated));

      const result = await service.addContribution(HH, GOAL_ID, 5000);

      expect(result).toBe(updated);
      expect(goalModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
      expect(goalModel.findOneAndUpdate).toHaveBeenCalledWith(
        {
          _id: new Types.ObjectId(GOAL_ID),
          householdId: new Types.ObjectId(HH),
        },
        { $inc: { currentCents: 5000 } },
        { new: true },
      );
      expect(goalModel.findById).not.toHaveBeenCalled();
    });

    it('applies a negative correction', async () => {
      goalModel.findOneAndUpdate.mockReturnValue(createChainable(goalDoc()));
      await service.addContribution(HH, GOAL_ID, -1200);
      expect(goalModel.findOneAndUpdate.mock.calls[0][1]).toEqual({
        $inc: { currentCents: -1200 },
      });
    });

    it("404s on another household's goal", async () => {
      goalModel.findOneAndUpdate.mockReturnValue(createChainable(null));
      await expect(
        service.addContribution(OTHER_HH, GOAL_ID, 100),
      ).rejects.toThrow(NotFoundException);
    });

    it('404s for a malformed id without querying', async () => {
      await expect(service.addContribution(HH, 'nope', 100)).rejects.toThrow(
        NotFoundException,
      );
      expect(goalModel.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes scoped to the household', async () => {
      await service.remove(HH, GOAL_ID);
      expect(goalModel.deleteOne).toHaveBeenCalledWith({
        _id: new Types.ObjectId(GOAL_ID),
        householdId: new Types.ObjectId(HH),
      });
    });

    it('404s when nothing in the household matched', async () => {
      goalModel.deleteOne.mockReturnValue(createChainable({ deletedCount: 0 }));
      await expect(service.remove(HH, GOAL_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
