import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { SpendingQueryDto } from './spending-query.dto';

function errorsFor(query: Record<string, unknown>): string[] {
  const dto = plainToInstance(SpendingQueryDto, query);
  return validateSync(dto).flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('SpendingQueryDto', () => {
  it('accepts a valid month', () => {
    expect(errorsFor({ month: '2026-03' })).toEqual([]);
  });

  it.each(['2026-13', '2026-1', '2026-00', '26-03', 'nope', '2026-03-01'])(
    'rejects malformed month %s with the YYYY-MM message',
    (bad) => {
      expect(errorsFor({ month: bad })).toEqual([
        'month must be a month in YYYY-MM format',
      ]);
    },
  );

  it('requires month', () => {
    expect(errorsFor({})).not.toEqual([]);
  });
});
