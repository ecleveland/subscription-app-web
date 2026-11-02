import { ConflictException } from '@nestjs/common';

// MongoDB duplicate-key error code, raised when a write violates a unique index.
export const DUPLICATE_KEY = 11000;

export function isDuplicateKeyError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as { code: number }).code === DUPLICATE_KEY
  );
}

// Map a duplicate-name unique-index violation to a client-facing 409. Keyed
// on the violated index actually covering `name` (when the driver reports
// one), so a future non-name unique index isn't mislabeled as a name
// conflict. Anything else is returned unchanged when it's an Error, else
// wrapped in one. Returns rather than throws for `throw`-site clarity.
export function asConflictIfDuplicate(error: unknown, message: string): Error {
  if (isDuplicateKeyError(error)) {
    const keyPattern = (error as { keyPattern?: Record<string, unknown> })
      .keyPattern;
    if (!keyPattern || 'name' in keyPattern) {
      return new ConflictException(message);
    }
  }
  return error instanceof Error ? error : new Error(String(error));
}
