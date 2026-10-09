import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { NetWorthQueryDto } from './net-worth-query.dto';

function errorsFor(query: Record<string, unknown>): string[] {
  const dto = plainToInstance(NetWorthQueryDto, query);
  return validateSync(dto).flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('NetWorthQueryDto', () => {
  it('inherits the shared month range rules', () => {
    expect(errorsFor({ from: '2026-01', to: '2026-12' })).toEqual([]);
    expect(errorsFor({ from: '2024-01', to: '2027-01' })[0]).toMatch(
      /36 months/,
    );
    expect(errorsFor({ from: '2026-04', to: '2026-03' })[0]).toMatch(
      /from must not be after to/,
    );
  });
});
