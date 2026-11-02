import { ConflictException } from '@nestjs/common';
import { asConflictIfDuplicate, isDuplicateKeyError } from './mongo-errors';

function mongoError(code: number, keyPattern?: Record<string, number>): Error {
  return Object.assign(new Error(`E${code}`), { code, keyPattern });
}

describe('isDuplicateKeyError', () => {
  it('is true for an Error with code 11000', () => {
    expect(isDuplicateKeyError(mongoError(11000))).toBe(true);
  });

  it('is false for an Error with another code', () => {
    expect(isDuplicateKeyError(mongoError(121))).toBe(false);
  });

  it('is false for a non-Error value carrying code 11000', () => {
    expect(isDuplicateKeyError({ code: 11000 })).toBe(false);
  });
});

describe('asConflictIfDuplicate', () => {
  const MESSAGE = 'A thing with this name already exists';

  it('returns a ConflictException with the message when keyPattern is absent', () => {
    const result = asConflictIfDuplicate(mongoError(11000), MESSAGE);

    expect(result).toBeInstanceOf(ConflictException);
    expect(result.message).toBe(MESSAGE);
  });

  it('returns a ConflictException with the message when keyPattern includes name', () => {
    const result = asConflictIfDuplicate(
      mongoError(11000, { householdId: 1, name: 1 }),
      MESSAGE,
    );

    expect(result).toBeInstanceOf(ConflictException);
    expect(result.message).toBe(MESSAGE);
  });

  it('returns the original Error for a duplicate on an index without name', () => {
    const error = mongoError(11000, { householdId: 1, color: 1 });

    expect(asConflictIfDuplicate(error, MESSAGE)).toBe(error);
  });

  it('returns the original Error for a non-duplicate error', () => {
    const error = mongoError(121);

    expect(asConflictIfDuplicate(error, MESSAGE)).toBe(error);
  });

  it('wraps a non-Error thrown value in an Error', () => {
    const result = asConflictIfDuplicate('boom', MESSAGE);

    expect(result).toBeInstanceOf(Error);
    expect(result).not.toBeInstanceOf(ConflictException);
    expect(result.message).toBe('boom');
  });
});
