import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ParseObjectIdPipe } from './parse-object-id.pipe';

describe('ParseObjectIdPipe', () => {
  const pipe = new ParseObjectIdPipe();

  it('returns the value unchanged for a valid ObjectId', () => {
    const id = new Types.ObjectId().toHexString();
    expect(pipe.transform(id)).toBe(id);
  });

  it.each(['', 'not-an-id', '123', '12345', 'zzzzzzzzzzzzzzzzzzzzzzzz'])(
    'throws BadRequestException for %p',
    (value) => {
      expect(() => pipe.transform(value)).toThrow(BadRequestException);
    },
  );
});
