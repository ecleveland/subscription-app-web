import { Types } from 'mongoose';
import {
  LABEL_FILTER_MESSAGE,
  LABEL_FILTER_PATTERN,
  labelFilterValue,
} from './label-filter';

const LABEL_ID = '507f191e810c19729de86101';

describe('labelFilterValue', () => {
  it("maps 'none' to null", () => {
    expect(labelFilterValue('none')).toBeNull();
  });

  it("maps 'any' to a not-null match", () => {
    expect(labelFilterValue('any')).toEqual({ $ne: null });
  });

  it('maps a label id to its ObjectId', () => {
    expect(labelFilterValue(LABEL_ID)).toEqual(new Types.ObjectId(LABEL_ID));
  });
});

describe('LABEL_FILTER_PATTERN', () => {
  it.each(['none', 'any', LABEL_ID, LABEL_ID.toUpperCase()])(
    'accepts %s',
    (raw) => {
      expect(LABEL_FILTER_PATTERN.test(raw)).toBe(true);
    },
  );

  it.each([
    'None',
    'Any',
    'personal',
    '',
    `${LABEL_ID}0`,
    `none${LABEL_ID}`,
    `any${LABEL_ID}`,
  ])('rejects %p', (raw) => {
    expect(LABEL_FILTER_PATTERN.test(raw)).toBe(false);
  });

  it("names 'none' and 'any' in the validation message", () => {
    expect(LABEL_FILTER_MESSAGE).toBe(
      "labelId must be a label id, 'none' for unlabeled records or 'any' for labeled records",
    );
  });
});
