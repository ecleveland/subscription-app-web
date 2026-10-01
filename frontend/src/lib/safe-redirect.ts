/**
 * Accepts only same-origin paths for post-login redirects. The target comes
 * from a query param, so without this check `?redirect=//evil.com` would be an
 * open redirect. Character checks on the raw string aren't enough because the
 * URL parser strips tab, CR and LF, turning `/\t/evil.com` into `//evil.com`.
 * So resolve against a fixed base and compare origins, then return the parsed
 * path, which is what the browser or router will actually follow.
 */
const BASE = 'http://safe-redirect.invalid';

export function safeRedirectPath(value: string | null | undefined): string {
  // Bare words like `household` resolve on-origin but aren't valid targets.
  if (!value || value[0] !== '/') return '/';
  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return '/';
  }
  if (url.origin !== BASE) return '/';
  // Dot segments can normalize to a protocol-relative path (/..//evil.com
  // becomes //evil.com), which the next resolve would treat as a host.
  if (url.pathname.startsWith('//')) return '/';
  return url.pathname + url.search + url.hash;
}
