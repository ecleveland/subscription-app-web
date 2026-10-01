import { safeRedirectPath } from '../safe-redirect';

describe('safeRedirectPath', () => {
  it.each(['/', '/household/accept?token=abc', '/a/b#frag'])(
    'accepts the same-origin path %s',
    (value) => {
      expect(safeRedirectPath(value)).toBe(value);
    },
  );

  it.each([
    null,
    undefined,
    '',
    '//evil.com',
    '/\\evil.com',
    'https://evil.com',
    'javascript:alert(1)',
    'household',
    // The URL parser strips tab, CR and LF, so these resolve to //evil.com.
    '/\t/evil.com',
    '/\n/evil.com',
    '/\r/evil.com',
    // Dot segments normalize away, leaving a protocol-relative //evil.com.
    '/..//evil.com',
  ])('falls back to / for %s', (value) => {
    expect(safeRedirectPath(value)).toBe('/');
  });

  it('keeps an inner space on the same origin by percent-encoding it', () => {
    expect(safeRedirectPath('/ /evil.com')).toBe('/%20/evil.com');
  });
});
