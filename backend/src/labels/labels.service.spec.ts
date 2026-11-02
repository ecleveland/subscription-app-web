import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { LabelsService } from './labels.service';
import { Label } from './schemas/label.schema';
import { Transaction } from '../transactions/schemas/transaction.schema';
import { RecurringTransaction } from '../recurring/schemas/recurring-transaction.schema';
import { Goal } from '../goals/schemas/goal.schema';

const HOUSEHOLD_ID = '507f191e810c19729de860ea';
const LABEL_ID = '507f191e810c19729de86101';
const PARENT_ID = '507f191e810c19729de86102';
const CHILD_ID = '507f191e810c19729de86103';

const DUPLICATE_NAME_MESSAGE =
  'A label with this name already exists in this household (possibly archived)';

function createChainable(resolvedValue: any = null) {
  const chain: any = {};
  chain.sort = jest.fn().mockReturnValue(chain);
  chain.collation = jest.fn().mockReturnValue(chain);
  chain.exec = jest.fn().mockResolvedValue(resolvedValue);
  return chain;
}

function duplicateKeyError(
  keyPattern: Record<string, number> = { householdId: 1, name: 1 },
): Error {
  return Object.assign(new Error('E11000 duplicate key'), {
    code: 11000,
    keyPattern,
  });
}

// A hydrated label as findOne returns it, with save and deleteOne spies.
function labelDoc(overrides: Record<string, any> = {}) {
  const doc: any = {
    _id: new Types.ObjectId(LABEL_ID),
    householdId: new Types.ObjectId(HOUSEHOLD_ID),
    name: 'Consulting',
    color: '#336699',
    isArchived: false,
    parentId: undefined,
    ...overrides,
  };
  doc.save = jest.fn().mockResolvedValue(doc);
  doc.deleteOne = jest.fn().mockResolvedValue({});
  return doc;
}

describe('LabelsService', () => {
  let service: LabelsService;
  let labelModel: any;
  let transactionModel: any;
  let recurringModel: any;
  let goalModel: any;
  let labelSave: jest.Mock;

  beforeEach(async () => {
    labelSave = jest.fn().mockImplementation(function (this: any) {
      return Promise.resolve({ _id: new Types.ObjectId(), ...this });
    });
    labelModel = jest
      .fn()
      .mockImplementation((doc: any) => ({ ...doc, save: labelSave }));
    labelModel.find = jest.fn().mockReturnValue(createChainable([]));
    labelModel.findOne = jest.fn().mockReturnValue(createChainable(null));
    labelModel.exists = jest.fn().mockReturnValue(createChainable(null));

    transactionModel = {
      exists: jest.fn().mockReturnValue(createChainable(null)),
    };
    recurringModel = {
      exists: jest.fn().mockReturnValue(createChainable(null)),
    };
    goalModel = { exists: jest.fn().mockReturnValue(createChainable(null)) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LabelsService,
        { provide: getModelToken(Label.name), useValue: labelModel },
        {
          provide: getModelToken(Transaction.name),
          useValue: transactionModel,
        },
        {
          provide: getModelToken(RecurringTransaction.name),
          useValue: recurringModel,
        },
        { provide: getModelToken(Goal.name), useValue: goalModel },
      ],
    }).compile();

    service = module.get<LabelsService>(LabelsService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('list', () => {
    it('hides archived labels by default and sorts by name', async () => {
      const chain = createChainable([labelDoc()]);
      labelModel.find.mockReturnValue(chain);

      const result = await service.list(HOUSEHOLD_ID);

      expect(labelModel.find).toHaveBeenCalledWith({
        householdId: new Types.ObjectId(HOUSEHOLD_ID),
        isArchived: false,
      });
      expect(chain.sort).toHaveBeenCalledWith({ name: 1 });
      expect(result).toHaveLength(1);
    });

    it('includes archived labels when asked', async () => {
      await service.list(HOUSEHOLD_ID, true);

      expect(labelModel.find).toHaveBeenCalledWith({
        householdId: new Types.ObjectId(HOUSEHOLD_ID),
      });
    });
  });

  describe('create', () => {
    it('creates a household-scoped label without a parent', async () => {
      await service.create(HOUSEHOLD_ID, {
        name: 'Consulting',
        color: '#336699',
      });

      const built = labelModel.mock.calls[0][0];
      expect(built.householdId).toEqual(new Types.ObjectId(HOUSEHOLD_ID));
      expect(built.name).toBe('Consulting');
      expect(built.color).toBe('#336699');
      expect(built.parentId).toBeUndefined();
      expect(labelModel.findOne).not.toHaveBeenCalled();
      expect(labelSave).toHaveBeenCalledTimes(1);
    });

    it('stores a parent from the same household', async () => {
      labelModel.findOne.mockReturnValue(
        createChainable(labelDoc({ _id: new Types.ObjectId(PARENT_ID) })),
      );

      await service.create(HOUSEHOLD_ID, {
        name: 'Workshops',
        color: '#336699',
        parentId: PARENT_ID,
      });

      const lookup = labelModel.findOne.mock.calls[0][0];
      expect(lookup._id).toEqual(new Types.ObjectId(PARENT_ID));
      expect(lookup.householdId).toEqual(new Types.ObjectId(HOUSEHOLD_ID));
      expect(labelModel.mock.calls[0][0].parentId).toEqual(
        new Types.ObjectId(PARENT_ID),
      );
    });

    it('maps a duplicate name to a 409', async () => {
      labelSave.mockRejectedValue(duplicateKeyError());

      await expect(
        service.create(HOUSEHOLD_ID, { name: 'consulting', color: '#336699' }),
      ).rejects.toThrow(new ConflictException(DUPLICATE_NAME_MESSAGE));
    });

    it('rethrows a unique-index violation that does not cover name', async () => {
      const error = duplicateKeyError({ householdId: 1, color: 1 });
      labelSave.mockRejectedValue(error);

      await expect(
        service.create(HOUSEHOLD_ID, { name: 'Consulting', color: '#336699' }),
      ).rejects.toBe(error);
    });

    it('rejects a parent from another household with 400', async () => {
      labelModel.findOne.mockReturnValue(createChainable(null));

      await expect(
        service.create(HOUSEHOLD_ID, {
          name: 'Workshops',
          color: '#336699',
          parentId: PARENT_ID,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(labelSave).not.toHaveBeenCalled();
    });

    it('rejects an archived parent with 400', async () => {
      labelModel.findOne.mockReturnValue(
        createChainable(
          labelDoc({ _id: new Types.ObjectId(PARENT_ID), isArchived: true }),
        ),
      );

      await expect(
        service.create(HOUSEHOLD_ID, {
          name: 'Workshops',
          color: '#336699',
          parentId: PARENT_ID,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(labelSave).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('404s when the label is missing or in another household', async () => {
      labelModel.findOne.mockReturnValue(createChainable(null));

      await expect(
        service.update(HOUSEHOLD_ID, LABEL_ID, { name: 'Renamed' }),
      ).rejects.toThrow(NotFoundException);
      const lookup = labelModel.findOne.mock.calls[0][0];
      expect(lookup.householdId).toEqual(new Types.ObjectId(HOUSEHOLD_ID));
    });

    it('renames, recolors and archives through save', async () => {
      const doc = labelDoc();
      labelModel.findOne.mockReturnValue(createChainable(doc));

      await service.update(HOUSEHOLD_ID, LABEL_ID, {
        name: 'Advisory',
        color: '#aa0000',
        isArchived: true,
      });

      expect(doc.name).toBe('Advisory');
      expect(doc.color).toBe('#aa0000');
      expect(doc.isArchived).toBe(true);
      expect(doc.save).toHaveBeenCalledTimes(1);
    });

    it('clears the parent on null', async () => {
      const doc = labelDoc({ parentId: new Types.ObjectId(PARENT_ID) });
      labelModel.findOne.mockReturnValue(createChainable(doc));

      await service.update(HOUSEHOLD_ID, LABEL_ID, { parentId: null });

      expect(doc.parentId).toBeUndefined();
      expect(labelModel.findOne).toHaveBeenCalledTimes(1);
    });

    it('sets a parent from the same household', async () => {
      const doc = labelDoc();
      labelModel.findOne
        .mockReturnValueOnce(createChainable(doc))
        .mockReturnValueOnce(
          createChainable(labelDoc({ _id: new Types.ObjectId(PARENT_ID) })),
        );

      await service.update(HOUSEHOLD_ID, LABEL_ID, { parentId: PARENT_ID });

      expect(doc.parentId).toEqual(new Types.ObjectId(PARENT_ID));
      expect(doc.save).toHaveBeenCalledTimes(1);
    });

    it('rejects the label as its own parent', async () => {
      const doc = labelDoc();
      labelModel.findOne.mockReturnValue(createChainable(doc));

      await expect(
        service.update(HOUSEHOLD_ID, LABEL_ID, { parentId: LABEL_ID }),
      ).rejects.toThrow(BadRequestException);
      expect(doc.save).not.toHaveBeenCalled();
    });

    it('rejects a parent that is a descendant of the label', async () => {
      // LABEL is the grandparent of the proposed parent: LABEL > PARENT > CHILD.
      // Making CHILD the parent of LABEL would close a loop.
      const doc = labelDoc();
      labelModel.findOne
        .mockReturnValueOnce(createChainable(doc))
        .mockReturnValueOnce(
          createChainable(
            labelDoc({
              _id: new Types.ObjectId(CHILD_ID),
              parentId: new Types.ObjectId(PARENT_ID),
            }),
          ),
        )
        .mockReturnValueOnce(
          createChainable(
            labelDoc({
              _id: new Types.ObjectId(PARENT_ID),
              parentId: new Types.ObjectId(LABEL_ID),
            }),
          ),
        );

      await expect(
        service.update(HOUSEHOLD_ID, LABEL_ID, { parentId: CHILD_ID }),
      ).rejects.toThrow(BadRequestException);
      expect(doc.save).not.toHaveBeenCalled();
    });

    it('stops walking at a pre-existing loop that does not include the label', async () => {
      // PARENT and CHILD already point at each other. The walk must end rather
      // than spin, and the label is not part of that loop.
      const doc = labelDoc();
      const parent = labelDoc({
        _id: new Types.ObjectId(PARENT_ID),
        parentId: new Types.ObjectId(CHILD_ID),
      });
      const child = labelDoc({
        _id: new Types.ObjectId(CHILD_ID),
        parentId: new Types.ObjectId(PARENT_ID),
      });
      labelModel.findOne
        .mockReturnValueOnce(createChainable(doc))
        .mockReturnValueOnce(createChainable(parent))
        .mockReturnValueOnce(createChainable(child))
        .mockReturnValue(createChainable(parent));

      await service.update(HOUSEHOLD_ID, LABEL_ID, { parentId: PARENT_ID });

      expect(doc.parentId).toEqual(new Types.ObjectId(PARENT_ID));
    });

    it('skips parent validation when parentId is unchanged', async () => {
      const doc = labelDoc({ parentId: new Types.ObjectId(PARENT_ID) });
      labelModel.findOne.mockReturnValue(createChainable(doc));

      await service.update(HOUSEHOLD_ID, LABEL_ID, {
        parentId: PARENT_ID.toUpperCase(),
        name: 'Renamed',
      });

      expect(labelModel.findOne).toHaveBeenCalledTimes(1);
      expect(doc.save).toHaveBeenCalledTimes(1);
    });

    it('maps a rename collision to a 409', async () => {
      const doc = labelDoc();
      doc.save.mockRejectedValue(duplicateKeyError());
      labelModel.findOne.mockReturnValue(createChainable(doc));

      await expect(
        service.update(HOUSEHOLD_ID, LABEL_ID, { name: 'Taken' }),
      ).rejects.toThrow(new ConflictException(DUPLICATE_NAME_MESSAGE));
    });
  });

  describe('remove', () => {
    it('404s when the label is missing or in another household', async () => {
      labelModel.findOne.mockReturnValue(createChainable(null));

      await expect(service.remove(HOUSEHOLD_ID, LABEL_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns 409 while another label has it as parent', async () => {
      const doc = labelDoc();
      labelModel.findOne.mockReturnValue(createChainable(doc));
      labelModel.exists.mockReturnValue(
        createChainable({ _id: new Types.ObjectId(CHILD_ID) }),
      );

      await expect(service.remove(HOUSEHOLD_ID, LABEL_ID)).rejects.toThrow(
        new ConflictException('Re-parent or delete child labels first'),
      );
      const childFilter = labelModel.exists.mock.calls[0][0];
      expect(childFilter.householdId).toEqual(new Types.ObjectId(HOUSEHOLD_ID));
      expect(childFilter.parentId).toEqual(doc._id);
      expect(transactionModel.exists).not.toHaveBeenCalled();
      expect(doc.deleteOne).not.toHaveBeenCalled();
    });

    it.each([
      ['a transaction', () => transactionModel],
      ['a recurring template', () => recurringModel],
      ['a goal', () => goalModel],
    ])('archives a label referenced by %s', async (_name, model) => {
      const doc = labelDoc();
      labelModel.findOne.mockReturnValue(createChainable(doc));
      model().exists.mockReturnValue(
        createChainable({ _id: new Types.ObjectId() }),
      );

      const result = await service.remove(HOUSEHOLD_ID, LABEL_ID);

      expect(result).toEqual({ outcome: 'archived' });
      expect(doc.isArchived).toBe(true);
      expect(doc.save).toHaveBeenCalledTimes(1);
      expect(doc.deleteOne).not.toHaveBeenCalled();
      const filter = model().exists.mock.calls[0][0];
      expect(filter.householdId).toEqual(new Types.ObjectId(HOUSEHOLD_ID));
      expect(filter.labelId).toEqual(doc._id);
    });

    it('does not save again when a referenced label is already archived', async () => {
      const doc = labelDoc({ isArchived: true });
      labelModel.findOne.mockReturnValue(createChainable(doc));
      goalModel.exists.mockReturnValue(
        createChainable({ _id: new Types.ObjectId() }),
      );

      const result = await service.remove(HOUSEHOLD_ID, LABEL_ID);

      expect(result).toEqual({ outcome: 'archived' });
      expect(doc.save).not.toHaveBeenCalled();
    });

    it('hard-deletes an unreferenced label', async () => {
      const doc = labelDoc();
      labelModel.findOne.mockReturnValue(createChainable(doc));

      const result = await service.remove(HOUSEHOLD_ID, LABEL_ID);

      expect(result).toEqual({ outcome: 'deleted' });
      expect(doc.deleteOne).toHaveBeenCalledTimes(1);
      expect(doc.save).not.toHaveBeenCalled();
    });
  });

  describe('findInHousehold', () => {
    it('returns null for a malformed id without querying', async () => {
      await expect(
        service.findInHousehold(HOUSEHOLD_ID, 'not-an-id'),
      ).resolves.toBeNull();
      expect(labelModel.findOne).not.toHaveBeenCalled();
    });

    it('queries the label scoped to the household', async () => {
      const doc = labelDoc();
      labelModel.findOne.mockReturnValue(createChainable(doc));

      await expect(
        service.findInHousehold(HOUSEHOLD_ID, LABEL_ID),
      ).resolves.toBe(doc);
      expect(labelModel.findOne).toHaveBeenCalledWith({
        _id: new Types.ObjectId(LABEL_ID),
        householdId: new Types.ObjectId(HOUSEHOLD_ID),
      });
    });
  });

  describe('assertAssignable', () => {
    it('rejects a missing or foreign label with 400', async () => {
      labelModel.findOne.mockReturnValue(createChainable(null));

      await expect(
        service.assertAssignable(HOUSEHOLD_ID, LABEL_ID),
      ).rejects.toThrow(
        new BadRequestException(
          'labelId does not reference a label in this household',
        ),
      );
      expect(labelModel.findOne).toHaveBeenCalledWith({
        _id: new Types.ObjectId(LABEL_ID),
        householdId: new Types.ObjectId(HOUSEHOLD_ID),
      });
    });

    it('rejects a malformed id with the same 400, without querying', async () => {
      await expect(
        service.assertAssignable(HOUSEHOLD_ID, 'not-an-id'),
      ).rejects.toThrow(
        new BadRequestException(
          'labelId does not reference a label in this household',
        ),
      );
      expect(labelModel.findOne).not.toHaveBeenCalled();
    });

    it('rejects an archived label with 400', async () => {
      labelModel.findOne.mockReturnValue(
        createChainable(labelDoc({ isArchived: true })),
      );

      await expect(
        service.assertAssignable(HOUSEHOLD_ID, LABEL_ID),
      ).rejects.toThrow(
        new BadRequestException('Cannot assign an archived label'),
      );
    });

    it('resolves for an active label in the household', async () => {
      labelModel.findOne.mockReturnValue(createChainable(labelDoc()));

      await expect(
        service.assertAssignable(HOUSEHOLD_ID, LABEL_ID),
      ).resolves.toBeUndefined();
    });
  });
});
