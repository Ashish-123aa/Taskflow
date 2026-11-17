import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));

vi.mock('dns/promises', () => ({
  lookup: lookupMock,
}));

import { isBlockedIp, resolveSafeUrl, safeFetch } from '../src/utils/ssrf-guard';
import { NonRetryableJobError } from '../src/utils/errors';

beforeEach(() => {
  lookupMock.mockReset();
  lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
});

describe('isBlockedIp', () => {
  it.each([
    ['127.0.0.1', 'IPv4 loopback'],
    ['10.1.2.3', '10.0.0.0/8 private'],
    ['172.16.0.1', '172.16.0.0/12 private (lower bound)'],
    ['172.31.255.255', '172.16.0.0/12 private (upper bound)'],
    ['192.168.1.1', '192.168.0.0/16 private'],
    ['169.254.1.1', '169.254.0.0/16 link-local'],
    ['169.254.169.254', 'cloud metadata endpoint'],
    ['0.0.0.0', '"this network"'],
    ['100.64.0.1', '100.64.0.0/10 carrier-grade NAT'],
    ['192.0.2.1', 'TEST-NET-1'],
    ['198.51.100.1', 'TEST-NET-2'],
    ['203.0.113.1', 'TEST-NET-3'],
    ['224.0.0.1', 'multicast'],
    ['255.255.255.255', 'broadcast'],
  ])('blocks %s (%s)', (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each([
    ['8.8.8.8', "Google DNS"],
    ['1.1.1.1', 'Cloudflare DNS'],
    ['93.184.216.34', 'a normal public host'],
    ['172.15.255.255', 'just below the 172.16.0.0/12 private range'],
    ['172.32.0.0', 'just above the 172.16.0.0/12 private range'],
  ])('does not block %s (%s)', (ip) => {
    expect(isBlockedIp(ip)).toBe(false);
  });

  it.each([
    ['::1', 'IPv6 loopback'],
    ['fe80::1', 'IPv6 link-local'],
    ['fd00::1', 'IPv6 unique local (fd)'],
    ['fc00::1', 'IPv6 unique local (fc)'],
    ['ff02::1', 'IPv6 multicast'],
    ['::ffff:127.0.0.1', 'IPv4-mapped loopback (dotted form)'],
    ['::ffff:10.0.0.1', 'IPv4-mapped private address (dotted form)'],
    ['::ffff:7f00:1', 'IPv4-mapped loopback (fully-hex form)'],
  ])('blocks %s (%s)', (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it('does not block a normal public IPv6 address', () => {
    expect(isBlockedIp('2606:4700:4700::1111')).toBe(false);
  });

  it('blocks something that is not a valid IP literal at all, defensively', () => {
    expect(isBlockedIp('not-an-ip')).toBe(true);
  });
});

describe('resolveSafeUrl', () => {
  it('accepts a normal public https URL', async () => {
    const url = await resolveSafeUrl('https://example.com/path?query=1');
    expect(url.hostname).toBe('example.com');
  });

  it('rejects a malformed URL', async () => {
    await expect(resolveSafeUrl('not a url')).rejects.toThrow(NonRetryableJobError);
  });

  it('rejects a non-http(s) protocol', async () => {
    await expect(resolveSafeUrl('ftp://example.com/file')).rejects.toThrow(NonRetryableJobError);
  });

  it('rejects the file:// protocol', async () => {
    await expect(resolveSafeUrl('file:///etc/passwd')).rejects.toThrow(NonRetryableJobError);
  });

  it('blocks "localhost" by name, with no DNS lookup needed', async () => {
    await expect(resolveSafeUrl('http://localhost:4000/admin')).rejects.toThrow(NonRetryableJobError);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it.each(['127.0.0.1', '10.0.0.5', '172.16.5.5', '192.168.0.1', '169.254.169.254', '::1'])(
    'blocks the IP literal %s directly, with no DNS lookup needed',
    async (ip) => {
      const host = ip.includes(':') ? `[${ip}]` : ip;
      await expect(resolveSafeUrl(`http://${host}/`)).rejects.toThrow(NonRetryableJobError);
      expect(lookupMock).not.toHaveBeenCalled();
    },
  );

  it('normalizes and blocks a decimal-encoded loopback address', async () => {
    // 2130706433 === 127.0.0.1 — the WHATWG URL parser canonicalizes this
    // into dotted-decimal form before `hostname` is ever read.
    await expect(resolveSafeUrl('http://2130706433/')).rejects.toThrow(NonRetryableJobError);
  });

  it('resolves a hostname via DNS and allows it when every address is public', async () => {
    lookupMock.mockResolvedValueOnce([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    ]);
    const url = await resolveSafeUrl('http://public-service.example/');
    expect(url.hostname).toBe('public-service.example');
  });

  it('blocks a hostname that resolves to a private address (DNS-rebinding style attack)', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '10.0.0.5', family: 4 }]);
    await expect(resolveSafeUrl('http://attacker-controlled.example/')).rejects.toThrow(
      NonRetryableJobError,
    );
  });

  it('blocks a hostname if ANY of its resolved addresses is private, even if others are public', async () => {
    lookupMock.mockResolvedValueOnce([
      { address: '93.184.216.34', family: 4 },
      { address: '192.168.1.1', family: 4 },
    ]);
    await expect(resolveSafeUrl('http://mixed.example/')).rejects.toThrow(NonRetryableJobError);
  });

  it('rejects a hostname that fails to resolve', async () => {
    lookupMock.mockRejectedValueOnce(new Error('ENOTFOUND'));
    await expect(resolveSafeUrl('http://does-not-exist.invalid/')).rejects.toThrow(
      NonRetryableJobError,
    );
  });

  it('never leaks the resolved address or DNS error detail in its error message', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '10.1.2.3', family: 4 }]);
    await expect(resolveSafeUrl('http://internal.example/')).rejects.not.toThrow(/10\.1\.2\.3/);
  });
});

describe('safeFetch', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns the response and body for a normal request', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response('hello', { status: 200, headers: { 'content-type': 'text/plain' } }),
    ) as unknown as typeof fetch;

    const result = await safeFetch('https://example.com/', {
      timeoutMs: 5000,
      maxResponseBytes: 1000,
    });

    expect(result.response.status).toBe(200);
    expect(result.body).toBe('hello');
  });

  it('follows a redirect to an allowed target', async () => {
    const fetchMock = vi.fn(async (url: URL | string) => {
      if (url.toString() === 'https://start.example.com/') {
        return new Response(null, { status: 302, headers: { Location: 'https://end.example.com/' } });
      }
      return new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await safeFetch('https://start.example.com/', {
      timeoutMs: 5000,
      maxResponseBytes: 1000,
    });

    expect(result.response.status).toBe(200);
    expect(result.body).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('blocks a redirect to an internal address instead of following it', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(null, { status: 302, headers: { Location: 'http://169.254.169.254/latest/meta-data/' } }),
    ) as unknown as typeof fetch;

    await expect(
      safeFetch('https://start.example.com/', { timeoutMs: 5000, maxResponseBytes: 1000 }),
    ).rejects.toThrow(NonRetryableJobError);
  });

  it('gives up after too many redirects instead of looping forever', async () => {
    let hop = 0;
    global.fetch = vi.fn(async () => {
      hop += 1;
      return new Response(null, { status: 302, headers: { Location: `https://hop-${hop}.example.com/` } });
    }) as unknown as typeof fetch;

    await expect(
      safeFetch('https://start.example.com/', { timeoutMs: 5000, maxResponseBytes: 1000, maxRedirects: 2 }),
    ).rejects.toThrow(/too many redirects/i);
  });

  it('rejects a redirect response with no Location header', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 302 })) as unknown as typeof fetch;

    await expect(
      safeFetch('https://start.example.com/', { timeoutMs: 5000, maxResponseBytes: 1000 }),
    ).rejects.toThrow(NonRetryableJobError);
  });

  it('stops reading a response body that exceeds the size limit', async () => {
    const bigBody = 'x'.repeat(2000);
    global.fetch = vi.fn().mockResolvedValue(new Response(bigBody, { status: 200 })) as unknown as typeof fetch;

    await expect(
      safeFetch('https://start.example.com/', { timeoutMs: 5000, maxResponseBytes: 1000 }),
    ).rejects.toThrow(NonRetryableJobError);
  });

  it('allows a response body right at the size limit', async () => {
    const body = 'x'.repeat(1000);
    global.fetch = vi.fn().mockResolvedValue(
      new Response(body, { status: 200, headers: { 'content-type': 'text/plain' } }),
    ) as unknown as typeof fetch;

    const result = await safeFetch('https://start.example.com/', {
      timeoutMs: 5000,
      maxResponseBytes: 1000,
    });
    expect(result.body).toBe(body);
  });

  it('aborts a request that takes longer than the configured timeout', async () => {
    global.fetch = vi.fn((_url: unknown, opts: { signal: AbortSignal }) => {
      return new Promise<Response>((_resolve, reject) => {
        opts.signal.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted', 'AbortError'));
        });
      });
    }) as unknown as typeof fetch;

    await expect(
      safeFetch('https://start.example.com/', { timeoutMs: 30, maxResponseBytes: 1000 }),
    ).rejects.toThrow(/timed out/i);
  });

  it('never calls fetch at all for a blocked initial URL', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      safeFetch('http://192.168.1.1/', { timeoutMs: 5000, maxResponseBytes: 1000 }),
    ).rejects.toThrow(NonRetryableJobError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
