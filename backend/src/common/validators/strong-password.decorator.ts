import { applyDecorators } from '@nestjs/common';
import { IsString, MinLength, Matches } from 'class-validator';

// At least one lowercase, one uppercase, and one digit. Special characters are
// allowed but not required.
const STRONG_PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/;

/**
 * Shared password policy for every password-accepting DTO: a string of at
 * least 8 characters containing upper- and lower-case letters and a digit.
 */
export function StrongPassword(): PropertyDecorator {
  return applyDecorators(
    IsString(),
    MinLength(8),
    Matches(STRONG_PASSWORD_REGEX, {
      message:
        'password must be at least 8 characters and include uppercase, lowercase, and a number',
    }),
  );
}
