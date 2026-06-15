import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '../middleware';

function makeRequest(path: string, accessToken?: string): NextRequest {
  const req = new NextRequest(`http://localhost:3000${path}`);
  if (accessToken !== undefined) {
    req.cookies.set('access_token', accessToken);
  }
  return req;
}

function jwt(expOffsetSeconds: number): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = btoa(
    JSON.stringify({
      sub: '1',
      exp: Math.floor(Date.now() / 1000) + expOffsetSeconds,
    }),
  );
  return `${header}.${payload}.signature`;
}

function redirectLocation(res: ReturnType<typeof middleware>): string | null {
  return res.headers.get('location');
}

describe('middleware', () => {
  it('redirects an unauthenticated request for a protected path to /login', () => {
    const res = middleware(makeRequest('/'));
    expect(redirectLocation(res)).toContain('/login');
  });

  it('allows an authenticated request to a protected path through', () => {
    const res = middleware(makeRequest('/', jwt(900)));
    expect(redirectLocation(res)).toBeNull();
  });

  it('redirects an authenticated user away from a public path to /', () => {
    const res = middleware(makeRequest('/login', jwt(900)));
    const location = redirectLocation(res);
    expect(location).toMatch(/\/$/);
  });

  it('allows an unauthenticated request to a public path through', () => {
    const res = middleware(makeRequest('/login'));
    expect(redirectLocation(res)).toBeNull();
  });

  it('treats the legacy spoofable cookie value "1" as unauthenticated (regression)', () => {
    const res = middleware(makeRequest('/', '1'));
    expect(redirectLocation(res)).toContain('/login');
  });

  it('treats an expired access token as unauthenticated', () => {
    const res = middleware(makeRequest('/', jwt(-60)));
    expect(redirectLocation(res)).toContain('/login');
  });

  it('treats a structurally malformed token as unauthenticated', () => {
    const res = middleware(makeRequest('/', 'not.a.jwt'));
    expect(redirectLocation(res)).toContain('/login');
  });
});
