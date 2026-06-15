import { validateSync } from 'class-validator';
import { StrongPassword } from './strong-password.decorator';

class Dummy {
  @StrongPassword()
  password!: string;
}

function isValid(password: unknown): boolean {
  const dto = new Dummy();
  // @ts-expect-error — intentionally assigning arbitrary values under test
  dto.password = password;
  return validateSync(dto).length === 0;
}

describe('StrongPassword', () => {
  it('accepts a password with upper, lower, and a digit (>=8 chars)', () => {
    expect(isValid('Password1')).toBe(true);
    expect(isValid('e2e-Password123')).toBe(true);
  });

  it.each([
    ['too short', 'Pass1aa'], // 7 chars
    ['missing uppercase', 'password123'],
    ['missing lowercase', 'PASSWORD123'],
    ['missing digit', 'PasswordOnly'],
    ['not a string', 12345678],
  ])('rejects a password (%s)', (_label, value) => {
    expect(isValid(value)).toBe(false);
  });
});
