import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PATHS = [
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
];

/**
 * Best-effort gate to avoid flashing authed pages. Real authorization is the
 * backend's per-request JWT check; this only validates the access-token cookie's
 * structure and expiry (not its signature, which the edge runtime can't verify).
 * That's enough to reject the old spoofable `auth-flag=1` cookie.
 */
function hasValidAccessToken(token: string | undefined): boolean {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(
      atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')),
    ) as { exp?: number };
    if (typeof payload.exp !== 'number') return false;
    return payload.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

export function middleware(request: NextRequest) {
  const token = request.cookies.get('access_token')?.value;
  const isAuthenticated = hasValidAccessToken(token);
  const { pathname } = request.nextUrl;

  const isPublicPath = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  if (!isAuthenticated && !isPublicPath) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (isAuthenticated && isPublicPath) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
