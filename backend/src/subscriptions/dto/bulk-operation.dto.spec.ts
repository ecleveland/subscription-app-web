import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { BulkOperationDto, BulkAction } from './bulk-operation.dto';

function validate(payload: Record<string, unknown>) {
  return validateSync(plainToInstance(BulkOperationDto, payload));
}

describe('BulkOperationDto', () => {
  const validId = '507f1f77bcf86cd799439011';

  it('accepts an array of valid ObjectId strings', () => {
    expect(
      validate({ ids: [validId], action: BulkAction.DELETE }),
    ).toHaveLength(0);
  });

  it('rejects a non-ObjectId id (the gap @IsString missed)', () => {
    const errors = validate({ ids: ['not-an-id'], action: BulkAction.DELETE });
    expect(errors).not.toHaveLength(0);
    expect(errors[0].property).toBe('ids');
  });

  it('rejects when any id in the array is invalid', () => {
    const errors = validate({
      ids: [validId, 'bad'],
      action: BulkAction.DELETE,
    });
    expect(errors).not.toHaveLength(0);
    expect(errors[0].property).toBe('ids');
  });

  it('accepts exactly 100 ids', () => {
    const ids = Array.from({ length: 100 }, () => validId);
    expect(validate({ ids, action: BulkAction.DELETE })).toHaveLength(0);
  });

  it('rejects more than 100 ids (unbounded $in DoS guard)', () => {
    const ids = Array.from({ length: 101 }, () => validId);
    const errors = validate({ ids, action: BulkAction.DELETE });
    expect(errors).not.toHaveLength(0);
    expect(errors[0].property).toBe('ids');
  });
});
