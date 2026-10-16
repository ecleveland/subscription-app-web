import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { GoalsService } from './goals.service';
import { Goal, GoalType } from './schemas/goal.schema';
import { CategoriesService } from '../categories/categories.service';
import { AccountsService } from '../accounts/accounts.service';
import { AccountType } from '../accounts/schemas/account.schema';

const HH = '507f191e810c19729de860ea';
const OTHER_HH = '507f191e810c19729de860eb';
const GOAL_ID = '507f191e810c19729de86001';
const CAT_ID = '507f191e810c19729de86011';
const ACC_ID = '507f191e810c19729de86021';
const ACC2_ID = '507f191e810c19729de86022';

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
  doc.toObject = jest.fn(() => plainCopy(doc));
  return doc;
}

// What toObject returns: the data fields without the document methods.
function plainCopy(doc: Record<string, unknown>) {
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(doc)) {
    if (typeof value !== 'function') copy[key] = value;
  }
  return copy;
}

// A goal tracking ACC_ID, baselined when the account held 10000.
function linkedGoalDoc(overrides: Record<string, unknown> = {}) {
  return goalDoc({
    accountId: new Types.ObjectId(ACC_ID),
    baselineCents: 10000,
    currentCents: 0,
    ...overrides,
  });
}

function accountDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(ACC_ID),
    householdId: new Types.ObjectId(HH),
    name: 'High-yield savings',
    type: AccountType.SAVINGS,
    balanceCents: 10000,
    isArchived: false,
    ...overrides,
  };
}

describe('GoalsService', () => {
  let service: GoalsService;
  let goalModel: any;
  let categoriesService: { findInHousehold: jest.Mock };
  let accountsService: { findOne: jest.Mock; findAll: jest.Mock };
  let constructed: any[];

  beforeEach(async () => {
    constructed = [];
    // The model doubles as a constructor (create) and a query surface.
    goalModel = jest
      .fn()
      .mockImplementation((data: Record<string, unknown>) => {
        const doc = { ...data, save: jest.fn() };
        const saved: any = { _id: new Types.ObjectId(GOAL_ID), ...data };
        saved.toObject = () => plainCopy(saved);
        doc.save.mockResolvedValue(saved);
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

    accountsService = {
      findOne: jest.fn().mockResolvedValue(accountDoc()),
      findAll: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoalsService,
        { provide: getModelToken(Goal.name), useValue: goalModel },
        { provide: CategoriesService, useValue: categoriesService },
        { provide: AccountsService, useValue: accountsService },
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

    it('rejects an archived category with 400', async () => {
      categoriesService.findInHousehold.mockResolvedValue({
        _id: new Types.ObjectId(CAT_ID),
        isArchived: true,
      });
      await expect(
        service.create(HH, {
          name: 'Vacation',
          type: GoalType.SAVINGS,
          targetCents: 300000,
          categoryId: CAT_ID,
        }),
      ).rejects.toThrow(
        new BadRequestException('Cannot link a goal to an archived category'),
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
      await expect(service.findOne(HH, GOAL_ID)).resolves.toMatchObject({
        name: 'Emergency fund',
        currentCents: 2500,
        linkedAccount: null,
      });
      expect(accountsService.findOne).not.toHaveBeenCalled();
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

      expect(result).toMatchObject({ currentCents: 7500, linkedAccount: null });
      expect(goalModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
      expect(goalModel.findOneAndUpdate).toHaveBeenCalledWith(
        {
          _id: new Types.ObjectId(GOAL_ID),
          householdId: new Types.ObjectId(HH),
          accountId: { $exists: false },
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

  describe('account link', () => {
    describe('derived progress on read', () => {
      it('derives a savings goal from the balance growth since the baseline', async () => {
        goalModel.findById.mockReturnValue(createChainable(linkedGoalDoc()));
        accountsService.findOne.mockResolvedValue(
          accountDoc({ balanceCents: 25000 }),
        );

        const view = await service.findOne(HH, GOAL_ID);

        expect(accountsService.findOne).toHaveBeenCalledWith(HH, ACC_ID);
        expect(view).toMatchObject({
          currentCents: 15000,
          linkedAccount: { accountId: ACC_ID, name: 'High-yield savings' },
        });
        expect(view).not.toHaveProperty('baselineCents');
      });

      it('derives a debt goal as paid down when a negative balance rises toward 0', async () => {
        goalModel.findById.mockReturnValue(
          createChainable(
            linkedGoalDoc({ type: GoalType.DEBT, baselineCents: -15000 }),
          ),
        );
        accountsService.findOne.mockResolvedValue(
          accountDoc({
            name: 'Car loan',
            type: AccountType.LOAN,
            balanceCents: -10000,
          }),
        );

        await expect(service.findOne(HH, GOAL_ID)).resolves.toMatchObject({
          currentCents: 5000,
          linkedAccount: { accountId: ACC_ID, name: 'Car loan' },
        });
      });

      it('does not write the derived value onto the document', async () => {
        const doc = linkedGoalDoc();
        goalModel.findById.mockReturnValue(createChainable(doc));
        accountsService.findOne.mockResolvedValue(
          accountDoc({ balanceCents: 25000 }),
        );
        await service.findOne(HH, GOAL_ID);
        expect(doc.currentCents).toBe(0);
      });

      it('keeps the link visible with stored currentCents and logs when the linked account is missing', async () => {
        const warn = jest
          .spyOn((service as any).logger, 'warn')
          .mockImplementation(() => undefined);
        goalModel.findById.mockReturnValue(
          createChainable(linkedGoalDoc({ currentCents: 700 })),
        );
        accountsService.findOne.mockRejectedValue(
          new NotFoundException('gone'),
        );

        await expect(service.findOne(HH, GOAL_ID)).resolves.toMatchObject({
          currentCents: 700,
          linkedAccount: { accountId: ACC_ID, name: 'Unavailable account' },
        });
        expect(warn).toHaveBeenCalled();
      });
    });

    describe('findAll', () => {
      it('loads the household accounts once when any goal is linked', async () => {
        const linked = linkedGoalDoc({
          _id: new Types.ObjectId(ACC2_ID),
        });
        const unlinked = goalDoc();
        goalModel.find.mockReturnValue(createChainable([linked, unlinked]));
        accountsService.findAll.mockResolvedValue([
          accountDoc({ balanceCents: 12000 }),
        ]);

        const views = await service.findAll(HH);

        expect(accountsService.findAll).toHaveBeenCalledTimes(1);
        expect(accountsService.findAll).toHaveBeenCalledWith(HH, true);
        expect(accountsService.findOne).not.toHaveBeenCalled();
        expect(views).toEqual([
          expect.objectContaining({
            currentCents: 2000,
            linkedAccount: { accountId: ACC_ID, name: 'High-yield savings' },
          }),
          expect.objectContaining({ currentCents: 2500, linkedAccount: null }),
        ]);
        expect(views[0]).not.toHaveProperty('baselineCents');
      });

      it('never loads accounts when no goal is linked', async () => {
        goalModel.find.mockReturnValue(createChainable([goalDoc()]));
        const views = await service.findAll(HH);
        expect(accountsService.findAll).not.toHaveBeenCalled();
        expect(views).toEqual([
          expect.objectContaining({ currentCents: 2500, linkedAccount: null }),
        ]);
      });

      it('keeps the link visible with stored currentCents and logs when a linked account is missing', async () => {
        const warn = jest
          .spyOn((service as any).logger, 'warn')
          .mockImplementation(() => undefined);
        goalModel.find.mockReturnValue(
          createChainable([linkedGoalDoc({ currentCents: 300 })]),
        );
        accountsService.findAll.mockResolvedValue([]);

        await expect(service.findAll(HH)).resolves.toEqual([
          expect.objectContaining({
            currentCents: 300,
            linkedAccount: { accountId: ACC_ID, name: 'Unavailable account' },
          }),
        ]);
        expect(warn).toHaveBeenCalled();
      });
    });

    describe('create', () => {
      it('baselines at the current balance so progress starts at 0', async () => {
        accountsService.findOne.mockResolvedValue(
          accountDoc({ balanceCents: 40000 }),
        );

        const view = await service.create(HH, {
          name: 'House',
          type: GoalType.SAVINGS,
          targetCents: 100000,
          accountId: ACC_ID,
        });

        expect(constructed[0].accountId).toEqual(new Types.ObjectId(ACC_ID));
        expect(constructed[0].baselineCents).toBe(40000);
        expect(constructed[0].currentCents).toBe(0);
        expect(view).toMatchObject({
          currentCents: 0,
          linkedAccount: { accountId: ACC_ID, name: 'High-yield savings' },
        });
        expect(view).not.toHaveProperty('baselineCents');
      });

      it('leaves the link fields unset without an accountId', async () => {
        await service.create(HH, {
          name: 'House',
          type: GoalType.SAVINGS,
          targetCents: 100000,
        });
        expect(constructed[0]).not.toHaveProperty('accountId');
        expect(constructed[0]).not.toHaveProperty('baselineCents');
        expect(accountsService.findOne).not.toHaveBeenCalled();
      });

      it("rejects another household's account with 400", async () => {
        accountsService.findOne.mockRejectedValue(
          new NotFoundException('Account not found'),
        );
        await expect(
          service.create(HH, {
            name: 'House',
            type: GoalType.SAVINGS,
            targetCents: 100000,
            accountId: ACC_ID,
          }),
        ).rejects.toThrow(
          new BadRequestException(
            `accountId "${ACC_ID}" does not reference an account in this household`,
          ),
        );
        expect(constructed).toHaveLength(0);
      });

      it('rejects an archived account with 400', async () => {
        accountsService.findOne.mockResolvedValue(
          accountDoc({ isArchived: true }),
        );
        await expect(
          service.create(HH, {
            name: 'House',
            type: GoalType.SAVINGS,
            targetCents: 100000,
            accountId: ACC_ID,
          }),
        ).rejects.toThrow(
          new BadRequestException('Cannot link a goal to an archived account'),
        );
        expect(constructed).toHaveLength(0);
      });

      it('rejects a savings goal on a credit or loan account with 400', async () => {
        for (const type of [AccountType.CREDIT, AccountType.LOAN]) {
          accountsService.findOne.mockResolvedValue(accountDoc({ type }));
          await expect(
            service.create(HH, {
              name: 'House',
              type: GoalType.SAVINGS,
              targetCents: 100000,
              accountId: ACC_ID,
            }),
          ).rejects.toThrow(
            new BadRequestException(
              'A savings goal can only track an asset account',
            ),
          );
        }
        expect(constructed).toHaveLength(0);
      });

      it('rejects a debt goal on an asset account with 400', async () => {
        for (const type of [
          AccountType.CHECKING,
          AccountType.SAVINGS,
          AccountType.CASH,
          AccountType.INVESTMENT,
        ]) {
          accountsService.findOne.mockResolvedValue(accountDoc({ type }));
          await expect(
            service.create(HH, {
              name: 'Card',
              type: GoalType.DEBT,
              targetCents: 100000,
              accountId: ACC_ID,
            }),
          ).rejects.toThrow(
            new BadRequestException(
              'A debt goal can only track a credit or loan account',
            ),
          );
        }
        expect(constructed).toHaveLength(0);
      });
    });

    describe('update', () => {
      it('links an existing goal atomically without moving its progress', async () => {
        const doc = goalDoc({ currentCents: 2500 });
        goalModel.findById.mockReturnValue(createChainable(doc));
        accountsService.findOne.mockResolvedValue(
          accountDoc({ balanceCents: 40000 }),
        );
        goalModel.findOneAndUpdate.mockReturnValue(
          createChainable(
            linkedGoalDoc({
              name: 'Renamed',
              currentCents: 2500,
              baselineCents: 37500,
            }),
          ),
        );

        const view = await service.update(HH, GOAL_ID, {
          accountId: ACC_ID,
          name: 'Renamed',
          categoryId: null,
        });

        // The filter pins the unlinked state and the currentCents the
        // baseline was computed from, so a contribution in between misses.
        expect(goalModel.findOneAndUpdate).toHaveBeenCalledWith(
          {
            _id: new Types.ObjectId(GOAL_ID),
            householdId: new Types.ObjectId(HH),
            currentCents: 2500,
            accountId: { $exists: false },
          },
          {
            $set: {
              accountId: new Types.ObjectId(ACC_ID),
              baselineCents: 37500,
              name: 'Renamed',
            },
            $unset: { categoryId: 1 },
          },
          { new: true, runValidators: true },
        );
        expect(doc.save).not.toHaveBeenCalled();
        expect(view).toMatchObject({
          name: 'Renamed',
          currentCents: 2500,
          linkedAccount: { accountId: ACC_ID, name: 'High-yield savings' },
        });
      });

      it('treats a resent accountId as no link change, whatever its case', async () => {
        const doc = linkedGoalDoc();
        goalModel.findById.mockReturnValue(createChainable(doc));
        // Archived would fail validation, so a pass proves no re-validation.
        accountsService.findOne.mockResolvedValue(
          accountDoc({ balanceCents: 16000, isArchived: true }),
        );

        const view = await service.update(HH, GOAL_ID, {
          accountId: ACC_ID.toUpperCase(),
          name: 'Renamed',
        });

        expect(doc.baselineCents).toBe(10000);
        expect(doc.currentCents).toBe(0);
        expect(doc.set).not.toHaveBeenCalledWith(
          'baselineCents',
          expect.anything(),
        );
        // The only accounts call resolves the view.
        expect(accountsService.findOne).toHaveBeenCalledTimes(1);
        expect(view).toMatchObject({ name: 'Renamed', currentCents: 6000 });
      });

      it('freezes progress then re-baselines when relinking to another account', async () => {
        const doc = linkedGoalDoc();
        goalModel.findById.mockReturnValue(createChainable(doc));
        accountsService.findOne.mockImplementation((_hh: string, id: string) =>
          Promise.resolve(
            id === ACC_ID
              ? accountDoc({ balanceCents: 16000 })
              : accountDoc({
                  _id: new Types.ObjectId(ACC2_ID),
                  name: 'Brokerage',
                  type: AccountType.INVESTMENT,
                  balanceCents: 50000,
                }),
          ),
        );

        goalModel.findOneAndUpdate.mockReturnValue(
          createChainable(
            linkedGoalDoc({
              accountId: new Types.ObjectId(ACC2_ID),
              currentCents: 6000,
              baselineCents: 44000,
            }),
          ),
        );

        const view = await service.update(HH, GOAL_ID, { accountId: ACC2_ID });

        // The filter pins the stored currentCents and the old link. $set
        // carries the frozen derived value.
        expect(goalModel.findOneAndUpdate).toHaveBeenCalledWith(
          {
            _id: new Types.ObjectId(GOAL_ID),
            householdId: new Types.ObjectId(HH),
            currentCents: 0,
            accountId: new Types.ObjectId(ACC_ID),
          },
          {
            $set: {
              currentCents: 6000,
              accountId: new Types.ObjectId(ACC2_ID),
              baselineCents: 44000,
            },
            $unset: {},
          },
          { new: true, runValidators: true },
        );
        expect(doc.save).not.toHaveBeenCalled();
        expect(view).toMatchObject({
          currentCents: 6000,
          linkedAccount: { accountId: ACC2_ID, name: 'Brokerage' },
        });
      });

      it('keeps the baseline when only the target changes', async () => {
        const doc = linkedGoalDoc();
        goalModel.findById.mockReturnValue(createChainable(doc));
        accountsService.findOne.mockResolvedValue(
          accountDoc({ balanceCents: 13000 }),
        );

        const view = await service.update(HH, GOAL_ID, {
          targetCents: 500000,
        });

        expect(doc.targetCents).toBe(500000);
        expect(doc.baselineCents).toBe(10000);
        expect(doc.accountId).toEqual(new Types.ObjectId(ACC_ID));
        expect(goalModel.findOneAndUpdate).not.toHaveBeenCalled();
        expect(view).toMatchObject({ targetCents: 500000, currentCents: 3000 });
      });

      it('unlinks atomically, freezing the derived value into currentCents', async () => {
        goalModel.findById.mockReturnValue(createChainable(linkedGoalDoc()));
        accountsService.findOne.mockResolvedValue(
          accountDoc({ balanceCents: 13000 }),
        );
        goalModel.findOneAndUpdate.mockReturnValue(
          createChainable(goalDoc({ name: 'Renamed', currentCents: 3000 })),
        );

        const view = await service.update(HH, GOAL_ID, {
          accountId: null,
          name: 'Renamed',
          targetDate: null,
        });

        expect(goalModel.findOneAndUpdate).toHaveBeenCalledWith(
          {
            _id: new Types.ObjectId(GOAL_ID),
            householdId: new Types.ObjectId(HH),
            // The link that was read, so a concurrent relink misses.
            accountId: new Types.ObjectId(ACC_ID),
          },
          {
            $set: { currentCents: 3000, name: 'Renamed' },
            $unset: { accountId: 1, baselineCents: 1, targetDate: 1 },
          },
          { new: true, runValidators: true },
        );
        expect(view).toMatchObject({
          name: 'Renamed',
          currentCents: 3000,
          linkedAccount: null,
        });
      });

      it('returns 409 when the goal changed between the read and the link write', async () => {
        goalModel.findById.mockReturnValue(createChainable(goalDoc()));
        accountsService.findOne.mockResolvedValue(accountDoc());
        goalModel.findOneAndUpdate.mockReturnValue(createChainable(null));

        await expect(
          service.update(HH, GOAL_ID, { accountId: ACC_ID }),
        ).rejects.toThrow(
          new ConflictException(
            'Goal was modified concurrently; retry the request',
          ),
        );
      });

      it('returns 409 when the goal changed between the read and the relink write', async () => {
        goalModel.findById.mockReturnValue(createChainable(linkedGoalDoc()));
        accountsService.findOne.mockResolvedValue(accountDoc());
        goalModel.findOneAndUpdate.mockReturnValue(createChainable(null));

        await expect(
          service.update(HH, GOAL_ID, { accountId: ACC2_ID }),
        ).rejects.toThrow(ConflictException);
      });

      it('applies the other edits by save when a concurrent unlink won', async () => {
        const unlinked = goalDoc({ currentCents: 3000 });
        goalModel.findById
          .mockReturnValueOnce(createChainable(linkedGoalDoc()))
          .mockReturnValueOnce(createChainable(unlinked));
        accountsService.findOne.mockResolvedValue(
          accountDoc({ balanceCents: 13000 }),
        );
        goalModel.findOneAndUpdate.mockReturnValue(createChainable(null));

        const view = await service.update(HH, GOAL_ID, {
          accountId: null,
          name: 'Renamed',
        });

        expect(unlinked.name).toBe('Renamed');
        expect(unlinked.save).toHaveBeenCalled();
        expect(view).toMatchObject({
          name: 'Renamed',
          currentCents: 3000,
          linkedAccount: null,
        });
      });

      it('leaves a concurrent relink in place and applies the other edits by save', async () => {
        const relinked = linkedGoalDoc({
          accountId: new Types.ObjectId(ACC2_ID),
          currentCents: 6000,
          baselineCents: 44000,
        });
        goalModel.findById
          .mockReturnValueOnce(createChainable(linkedGoalDoc()))
          .mockReturnValueOnce(createChainable(relinked));
        accountsService.findOne.mockImplementation((_hh: string, id: string) =>
          Promise.resolve(
            id === ACC_ID
              ? accountDoc({ balanceCents: 13000 })
              : accountDoc({
                  _id: new Types.ObjectId(ACC2_ID),
                  name: 'Brokerage',
                  type: AccountType.INVESTMENT,
                  balanceCents: 45000,
                }),
          ),
        );
        goalModel.findOneAndUpdate.mockReturnValue(createChainable(null));

        const view = await service.update(HH, GOAL_ID, {
          accountId: null,
          name: 'Renamed',
        });

        expect(relinked.name).toBe('Renamed');
        expect(relinked.currentCents).toBe(6000);
        expect(relinked.accountId).toEqual(new Types.ObjectId(ACC2_ID));
        expect(relinked.save).toHaveBeenCalled();
        expect(view).toMatchObject({
          name: 'Renamed',
          currentCents: 1000,
          linkedAccount: { accountId: ACC2_ID, name: 'Brokerage' },
        });
      });

      it('ignores a null accountId on an unlinked goal', async () => {
        const doc = goalDoc();
        goalModel.findById.mockReturnValue(createChainable(doc));

        await service.update(HH, GOAL_ID, { accountId: null, name: 'Same' });

        expect(goalModel.findOneAndUpdate).not.toHaveBeenCalled();
        expect(accountsService.findOne).not.toHaveBeenCalled();
        expect(doc.name).toBe('Same');
        expect(doc.save).toHaveBeenCalled();
      });

      it('rejects a foreign, archived or wrong-type account with 400 and saves nothing', async () => {
        const doc = goalDoc();
        goalModel.findById.mockReturnValue(createChainable(doc));

        accountsService.findOne.mockRejectedValueOnce(
          new NotFoundException('Account not found'),
        );
        await expect(
          service.update(HH, GOAL_ID, { accountId: ACC_ID }),
        ).rejects.toThrow(
          new BadRequestException(
            `accountId "${ACC_ID}" does not reference an account in this household`,
          ),
        );

        accountsService.findOne.mockResolvedValueOnce(
          accountDoc({ isArchived: true }),
        );
        await expect(
          service.update(HH, GOAL_ID, { accountId: ACC_ID }),
        ).rejects.toThrow(
          new BadRequestException('Cannot link a goal to an archived account'),
        );

        accountsService.findOne.mockResolvedValueOnce(
          accountDoc({ type: AccountType.CREDIT }),
        );
        await expect(
          service.update(HH, GOAL_ID, { accountId: ACC_ID }),
        ).rejects.toThrow(
          new BadRequestException(
            'A savings goal can only track an asset account',
          ),
        );

        expect(doc.save).not.toHaveBeenCalled();
        expect(goalModel.findOneAndUpdate).not.toHaveBeenCalled();
        expect(doc).not.toHaveProperty('accountId');
      });

      it('rejects a type change the linked account cannot back with 400', async () => {
        const doc = linkedGoalDoc();
        goalModel.findById.mockReturnValue(createChainable(doc));
        accountsService.findOne.mockResolvedValue(
          accountDoc({ type: AccountType.CHECKING }),
        );

        await expect(
          service.update(HH, GOAL_ID, { type: GoalType.DEBT }),
        ).rejects.toThrow(
          new BadRequestException(
            'A debt goal can only track a credit or loan account',
          ),
        );
        expect(doc.save).not.toHaveBeenCalled();
      });

      it('validates a new account against the new type in the same request', async () => {
        const doc = goalDoc();
        goalModel.findById.mockReturnValue(createChainable(doc));
        accountsService.findOne.mockResolvedValue(
          accountDoc({ type: AccountType.LOAN, balanceCents: -20000 }),
        );

        goalModel.findOneAndUpdate.mockReturnValue(
          createChainable(
            linkedGoalDoc({ type: GoalType.DEBT, baselineCents: -22500 }),
          ),
        );

        await service.update(HH, GOAL_ID, {
          type: GoalType.DEBT,
          accountId: ACC_ID,
        });

        expect(goalModel.findOneAndUpdate.mock.calls[0][1].$set).toEqual({
          accountId: new Types.ObjectId(ACC_ID),
          baselineCents: -22500,
          type: GoalType.DEBT,
        });
      });
    });

    describe('addContribution', () => {
      it('rejects a contribution to a linked goal with 400', async () => {
        goalModel.findOneAndUpdate.mockReturnValue(createChainable(null));
        goalModel.findById.mockReturnValue(createChainable(linkedGoalDoc()));

        await expect(service.addContribution(HH, GOAL_ID, 100)).rejects.toThrow(
          new BadRequestException(
            'Contributions are disabled while a goal tracks an account',
          ),
        );
      });

      it('404s when the goal does not exist', async () => {
        goalModel.findOneAndUpdate.mockReturnValue(createChainable(null));
        goalModel.findById.mockReturnValue(createChainable(null));

        await expect(service.addContribution(HH, GOAL_ID, 100)).rejects.toThrow(
          NotFoundException,
        );
      });
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
