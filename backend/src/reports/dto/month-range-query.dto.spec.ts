import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { MonthRangeQueryDto, MAX_REPORT_MONTHS } from './month-range-query.dto';

function errorsFor(query: Record<string, unknown>): string[] {
  const dto = plainToInstance(MonthRangeQueryDto, query);
  return validateSync(dto).flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('MonthRangeQueryDto', () => {
  it('caps the range at 36 months', () => {
    expect(MAX_REPORT_MONTHS).toBe(36);
  });

  it('accepts a single-month range', () => {
    expect(errorsFor({ from: '2026-03', to: '2026-03' })).toEqual([]);
  });

  it('accepts exactly 36 months inclusive', () => {
    expect(errorsFor({ from: '2024-01', to: '2026-12' })).toEqual([]);
  });

  it('rejects 37 months inclusive', () => {
    const errors = errorsFor({ from: '2024-01', to: '2027-01' });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/36 months/);
  });

  it('rejects from after to', () => {
    const errors = errorsFor({ from: '2026-04', to: '2026-03' });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/from must not be after to/);
  });

  it.each(['2026-13', '2026-1', '2026-00', '26-03', 'nope', '2026-03-01'])(
    'rejects malformed month %s',
    (bad) => {
      expect(errorsFor({ from: bad, to: '2026-03' })).not.toEqual([]);
      expect(errorsFor({ from: '2026-03', to: bad })).not.toEqual([]);
    },
  );

  it('requires both params', () => {
    expect(errorsFor({ to: '2026-03' })).not.toEqual([]);
    expect(errorsFor({ from: '2026-03' })).not.toEqual([]);
    expect(errorsFor({})).not.toEqual([]);
  });

  it('reports only the format error when the range check cannot run', () => {
    const errors = errorsFor({ from: 'nope', to: '2026-03' });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/YYYY-MM/);
  });
});
