import { describe, expect, it } from 'vitest';
import { extractTokenFromCookieHeader } from '../src/websocket/cookie';

describe('extractTokenFromCookieHeader', () => {
  it('returns undefined when there is no cookie header at all', () => {
    expect(extractTokenFromCookieHeader(undefined)).toBeUndefined();
  });

  it('returns undefined when the auth cookie is not present', () => {
    expect(extractTokenFromCookieHeader('other_cookie=abc; another=def')).toBeUndefined();
  });

  it('extracts the token when it is the only cookie', () => {
    expect(extractTokenFromCookieHeader('taskflow_token=abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('extracts the token when it is among several cookies', () => {
    const header = 'session_id=xyz; taskflow_token=abc.def.ghi; theme=dark';
    expect(extractTokenFromCookieHeader(header)).toBe('abc.def.ghi');
  });

  it('handles a URL-encoded cookie value correctly', () => {
    // cookie values containing '.', which JWTs do, don't normally need
    // encoding, but this confirms decoding doesn't corrupt one that is.
    const header = 'taskflow_token=abc%2Edef%2Eghi';
    expect(extractTokenFromCookieHeader(header)).toBe('abc.def.ghi');
  });
});
