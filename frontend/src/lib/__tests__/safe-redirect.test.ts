import { loginUrlFor, safeRedirectPath, withRedirect } from '../safe-redirect';

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

describe('withRedirect', () => {
  it.each([null, undefined, ''])('returns the path unchanged for %s', (target) => {
    expect(withRedirect('/login', target)).toBe('/login');
  });

  it('appends the encoded target as ?redirect', () => {
    expect(withRedirect('/login', '/household/accept?token=abc')).toBe(
      '/login?redirect=%2Fhousehold%2Faccept%3Ftoken%3Dabc',
    );
  });
});

describe('loginUrlFor', () => {
  it.each([
    // A protected page becomes the redirect target.
    ['/household/accept?token=abc', '/login?redirect=%2Fhousehold%2Faccept%3Ftoken%3Dabc'],
    ['/transactions?page=2', '/login?redirect=%2Ftransactions%3Fpage%3D2'],
    // The home page needs no param.
    ['/', '/login'],
    // On a public auth page, keep the redirect the user already carries.
    ['/login?redirect=%2Fhousehold', '/login?redirect=%2Fhousehold'],
    ['/login', '/login'],
    [
      '/register?redirect=%2Fhousehold%2Faccept%3Ftoken%3Dabc',
      '/login?redirect=%2Fhousehold%2Faccept%3Ftoken%3Dabc',
    ],
    // An off-site carried redirect is dropped.
    ['/forgot-password?redirect=%2F%2Fevil.com', '/login'],
  ])('maps %s to %s', (current, expected) => {
    expect(loginUrlFor(current)).toBe(expected);
  });
});
