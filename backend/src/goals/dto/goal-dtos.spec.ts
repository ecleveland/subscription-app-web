import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateGoalDto } from './create-goal.dto';
import { UpdateGoalDto } from './update-goal.dto';
import { ContributeGoalDto } from './contribute-goal.dto';

function errorsFor<T extends object>(
  cls: new () => T,
  payload: Record<string, unknown>,
): string[] {
  return validateSync(plainToInstance(cls, payload)).map((e) => e.property);
}

const valid = { name: 'Emergency fund', type: 'savings', targetCents: 100000 };

describe('CreateGoalDto', () => {
  it('accepts a minimal savings goal', () => {
    expect(errorsFor(CreateGoalDto, valid)).toEqual([]);
  });

  it('accepts a debt goal with a date and category', () => {
    expect(
      errorsFor(CreateGoalDto, {
        ...valid,
        type: 'debt',
        targetDate: '2027-06-01',
        categoryId: '507f191e810c19729de86011',
      }),
    ).toEqual([]);
  });

  it('rejects targetCents of 0', () => {
    expect(errorsFor(CreateGoalDto, { ...valid, targetCents: 0 })).toEqual([
      'targetCents',
    ]);
  });

  it('rejects a non-integer targetCents', () => {
    expect(errorsFor(CreateGoalDto, { ...valid, targetCents: 10.5 })).toEqual([
      'targetCents',
    ]);
  });

  it('rejects an unknown type', () => {
    expect(errorsFor(CreateGoalDto, { ...valid, type: 'sinking' })).toEqual([
      'type',
    ]);
  });

  it('rejects a missing name', () => {
    expect(errorsFor(CreateGoalDto, { ...valid, name: '' })).toEqual(['name']);
  });

  it('rejects a malformed categoryId and targetDate', () => {
    expect(
      errorsFor(CreateGoalDto, {
        ...valid,
        categoryId: 'nope',
        targetDate: 'tomorrow',
      }).sort(),
    ).toEqual(['categoryId', 'targetDate']);
  });
});

describe('UpdateGoalDto', () => {
  it('accepts an empty patch', () => {
    expect(errorsFor(UpdateGoalDto, {})).toEqual([]);
  });

  it('accepts null to clear targetDate and categoryId', () => {
    expect(
      errorsFor(UpdateGoalDto, { targetDate: null, categoryId: null }),
    ).toEqual([]);
  });

  it('rejects null on a required field', () => {
    expect(errorsFor(UpdateGoalDto, { name: null }).sort()).toEqual(['name']);
    expect(errorsFor(UpdateGoalDto, { targetCents: null })).toEqual([
      'targetCents',
    ]);
  });

  it('rejects targetCents of 0 and a bad type', () => {
    expect(
      errorsFor(UpdateGoalDto, { targetCents: 0, type: 'other' }).sort(),
    ).toEqual(['targetCents', 'type']);
  });

  it('accepts the archive flag', () => {
    expect(errorsFor(UpdateGoalDto, { isArchived: true })).toEqual([]);
  });
});

describe('ContributeGoalDto', () => {
  it('accepts a positive amount', () => {
    expect(errorsFor(ContributeGoalDto, { amountCents: 5000 })).toEqual([]);
  });

  it('accepts a negative correction', () => {
    expect(errorsFor(ContributeGoalDto, { amountCents: -250 })).toEqual([]);
  });

  it('rejects 0', () => {
    expect(errorsFor(ContributeGoalDto, { amountCents: 0 })).toEqual([
      'amountCents',
    ]);
  });

  it('rejects a non-integer', () => {
    expect(errorsFor(ContributeGoalDto, { amountCents: 1.5 })).toEqual([
      'amountCents',
    ]);
  });

  it('rejects a missing amount', () => {
    expect(errorsFor(ContributeGoalDto, {})).toEqual(['amountCents']);
  });
});
