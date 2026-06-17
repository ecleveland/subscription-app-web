import { parseAmountToCents } from './csv-import.util';

describe('parseAmountToCents', () => {
  it.each([
    ['1234.56', 123456],
    ['$1,234.56', 123456],
    ['1234.5', 123450],
    ['50', 5000],
    ['0.07', 7],
    ['-50.00', -5000],
    ['+50', 5000],
    ['(1,234.56)', -123456],
    ['$ (12.30)', -1230],
    ['  $1,000  ', 100000],
    ['1.1', 110],
  ])('parses %s -> %d cents', (input, expected) => {
    expect(parseAmountToCents(input)).toBe(expected);
  });

  it.each([
    ['', null],
    ['abc', null],
    ['1.2.3', null],
    ['--5', null],
    ['$', null],
    ['12-34', null],
  ])('rejects %s as unparseable', (input, expected) => {
    expect(parseAmountToCents(input)).toBe(expected);
  });

  it('returns null for non-string input', () => {
    expect(parseAmountToCents(undefined)).toBeNull();
    expect(parseAmountToCents(42 as unknown as string)).toBeNull();
  });

  it('rounds to the nearest cent without float drift', () => {
    expect(parseAmountToCents('19.99')).toBe(1999);
    expect(parseAmountToCents('0.1')).toBe(10);
  });
});
