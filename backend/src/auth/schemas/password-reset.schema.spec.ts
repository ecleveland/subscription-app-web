import { PasswordResetSchema } from './password-reset.schema';

describe('PasswordResetSchema indexes', () => {
  it('indexes email for prior-token invalidation on reset requests', () => {
    // requestPasswordReset runs updateMany({ email, usedAt }) on every request.
    expect(PasswordResetSchema.path('email').options.index).toBe(true);
  });
});
