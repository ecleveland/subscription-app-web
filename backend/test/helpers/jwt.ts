// Decode the `sub` (user id) claim from a JWT issued by the test app's
// register/login endpoints. Shared by the e2e specs that need the user id to
// look up household membership.
export function userIdFromToken(token: string): string {
  const payload = JSON.parse(
    Buffer.from(token.split('.')[1], 'base64').toString('utf8'),
  ) as { sub: string };
  return payload.sub;
}
