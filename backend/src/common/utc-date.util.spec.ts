import { parseUtcDate, utcDay } from './utc-date.util';

describe('parseUtcDate', () => {
  it('parses a date-only string as UTC midnight', () => {
    expect(parseUtcDate('2026-08-01').toISOString()).toBe(
      '2026-08-01T00:00:00.000Z',
    );
  });

  it('pins a T-separated offsetless datetime to UTC', () => {
    expect(parseUtcDate('2026-08-01T20:00:00').toISOString()).toBe(
      '2026-08-01T20:00:00.000Z',
    );
  });

  it('pins a space-separated offsetless datetime to UTC', () => {
    // isISO8601 (behind @IsDateString) accepts the space separator too; it
    // must get the same UTC pinning or the parse is server-timezone
    // dependent again.
    expect(parseUtcDate('2026-08-01 20:00:00').toISOString()).toBe(
      '2026-08-01T20:00:00.000Z',
    );
  });

  it('pins minute-precision and fractional-second forms', () => {
    expect(parseUtcDate('2026-08-01T20:00').toISOString()).toBe(
      '2026-08-01T20:00:00.000Z',
    );
    expect(parseUtcDate('2026-08-01T20:00:00.250').toISOString()).toBe(
      '2026-08-01T20:00:00.250Z',
    );
  });

  it('leaves explicit offsets and Z untouched', () => {
    expect(parseUtcDate('2026-08-01T20:00:00Z').toISOString()).toBe(
      '2026-08-01T20:00:00.000Z',
    );
    expect(parseUtcDate('2026-08-02T00:00:00+02:00').toISOString()).toBe(
      '2026-08-01T22:00:00.000Z',
    );
  });

  it('yields Invalid Date for unparseable ISO variants (guarded upstream)', () => {
    expect(Number.isNaN(parseUtcDate('2026-W32').getTime())).toBe(true);
  });
});

describe('utcDay', () => {
  it('collapses instants to their UTC calendar day', () => {
    expect(utcDay(new Date('2026-08-01T23:59:59Z'))).toBe(
      utcDay(new Date('2026-08-01T00:00:00Z')),
    );
    expect(utcDay(new Date('2026-08-02T00:00:00Z'))).toBeGreaterThan(
      utcDay(new Date('2026-08-01T23:59:59Z')),
    );
  });
});
