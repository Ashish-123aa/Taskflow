import { parse as parseCookies } from 'cookie';

const COOKIE_NAME = 'taskflow_token';

/**
 * Socket.IO's handshake doesn't go through Express's own middleware stack
 * (cookie-parser included), so the auth cookie has to be pulled out of
 * the raw `Cookie` header by hand during the socket auth check. Kept as
 * its own pure function — no Socket.IO, no Express — specifically so it
 * can be unit tested directly (tests/cookie-token.test.ts) rather than
 * only indirectly through a full socket connection.
 */
export function extractTokenFromCookieHeader(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  const cookies = parseCookies(cookieHeader);
  return cookies[COOKIE_NAME];
}
