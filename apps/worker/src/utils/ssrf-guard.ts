import { isIP } from 'net';
import { lookup as dnsLookup } from 'dns/promises';
import { NonRetryableJobError } from './errors';

/**
 * API_REQUEST/SCHEDULED_API_FETCH builds an outbound HTTP request from a
 * URL the *user* supplies (section 16/57). Without the checks in this
 * file, TaskFlow itself becomes a proxy an attacker can use to reach
 * infrastructure that has no business being reachable from a job
 * payload: the API container's own internal ports, other services on
 * the same Docker network, a cloud provider's instance-metadata endpoint
 * at 169.254.169.254, or anything else sitting behind TaskFlow's own
 * network position. Every outbound call the handler makes goes through
 * `safeFetch` below instead of the bare global `fetch` — see
 * docs/security.md for the full write-up, including the one limitation
 * this file doesn't try to solve.
 */

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const DEFAULT_MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface SafeFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs: number;
  maxResponseBytes: number;
  maxRedirects?: number;
}

export interface SafeFetchResult {
  response: Response;
  body: string;
}

/**
 * Validates that a URL is safe to fetch: an allowed protocol, and a
 * hostname/IP that isn't loopback, private, link-local, or otherwise
 * internal-only (section 57's explicit list). Called once for the
 * initial URL and again for every redirect hop inside `safeFetch`, since
 * a redirect target is exactly as user-controlled as the original URL —
 * an attacker who can't submit `http://169.254.169.254/` directly can
 * just have their own public server 302 to it instead.
 *
 * Known limitation — not a full defense against DNS rebinding: this
 * resolves the hostname, validates the result, and only *then* lets
 * `fetch` make its own connection, which re-resolves the hostname
 * independently a moment later. A DNS record that changes between these
 * two lookups could in principle slip a blocked address past this check.
 * Closing that completely means pinning the exact IP this function
 * validated to the TCP connection `fetch` actually opens (a custom
 * connect/dispatcher hook), which is meaningfully more machinery than a
 * single-file guard can reasonably carry. Re-resolving and re-validating
 * on every redirect, with the DNS lookup happening immediately before
 * the request it gates, keeps the exploitation window as small as
 * practical without that extra layer — called out here rather than
 * silently assumed away.
 */
export async function resolveSafeUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new NonRetryableJobError(`"${rawUrl}" is not a valid URL`);
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new NonRetryableJobError(
      `URL protocol "${url.protocol}" is not allowed — only http and https are permitted`,
    );
  }

  // The WHATWG URL parser already canonicalizes IPv4 hostnames written
  // as shorthand, octal, hex, or a single decimal number (e.g. "127.1",
  // "0x7f000001", "2130706433") into plain dotted-decimal form, and an
  // IPv6 literal's brackets end up as part of `hostname` itself — so by
  // this point there's no extra decoding to do; just strip the brackets
  // before handing it to net.isIP()/dns.lookup(), neither of which
  // expects them.
  const hostname = url.hostname.replace(/^\[|\]$/g, '');

  if (hostname.toLowerCase() === 'localhost') {
    throw blockedAddressError();
  }

  if (isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      throw blockedAddressError();
    }
    return url;
  }

  let addresses: string[];
  try {
    const records = await dnsLookup(hostname, { all: true, verbatim: true });
    addresses = records.map((record) => record.address);
  } catch {
    throw new NonRetryableJobError(`Could not resolve hostname "${hostname}"`);
  }

  if (addresses.length === 0 || addresses.some(isBlockedIp)) {
    throw blockedAddressError();
  }

  return url;
}

function blockedAddressError(): NonRetryableJobError {
  // Deliberately generic (section 57: "return safe errors without
  // exposing internal details") — never echoes back which range or
  // resolved address actually tripped the check.
  return new NonRetryableJobError(
    'This URL points to a network address TaskFlow is not allowed to reach',
  );
}

/**
 * True for any IPv4/IPv6 address that is loopback, private, link-local
 * (including the 169.254.169.254 cloud-metadata address), or otherwise
 * not a genuine public-Internet address. Exported on its own, with zero
 * URL parsing or DNS involved, so the range logic can be unit tested
 * directly against a long list of addresses.
 */
export function isBlockedIp(address: string): boolean {
  const type = isIP(address);
  if (type === 4) return isBlockedIpv4(address);
  if (type === 6) return isBlockedIpv6(address);
  return true; // not a real IP literal at all — block defensively
}

function isBlockedIpv4(address: string): boolean {
  const rawParts = address.split('.').map(Number);
  if (
    rawParts.length !== 4 ||
    rawParts.some((part) => Number.isNaN(part) || part < 0 || part > 255)
  ) {
    return true;
  }
  // The length/range check above is the runtime guarantee that this is
  // really a 4-element tuple; the cast just lets noUncheckedIndexedAccess
  // treat a/b/c as plain numbers instead of `number | undefined` from
  // here on.
  const [a, b, c] = rawParts as [number, number, number, number];

  if (a === 0) return true; // 0.0.0.0/8 — "this network"
  if (a === 10) return true; // 10.0.0.0/8 — private
  if (a === 127) return true; // 127.0.0.0/8 — loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 — link-local, includes the 169.254.169.254 cloud metadata endpoint
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 — private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 — private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 — carrier-grade NAT
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24 — IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return true; // 192.0.2.0/24 — TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 — benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // 198.51.100.0/24 — TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // 203.0.113.0/24 — TEST-NET-3
  if (a >= 224) return true; // 224.0.0.0/4 multicast, 240.0.0.0/4 reserved, 255.255.255.255 broadcast

  return false;
}

function isBlockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;

  // An IPv4-mapped/compatible address can appear with a trailing
  // dotted-quad ("::ffff:127.0.0.1") — check that form directly first,
  // since the segment after the last colon isn't a 16-bit hex group and
  // the generic expansion below can't handle it.
  const dottedMatch = normalized.match(/^(?:.*:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dottedMatch) {
    // Capture group 1 is mandatory in the pattern above, so it's always
    // populated whenever `dottedMatch` itself is non-null; the fallback
    // only exists to satisfy noUncheckedIndexedAccess, and would still
    // resolve to "blocked" (via isBlockedIpv4 rejecting an empty string)
    // in the unreachable case it ever mattered.
    return isBlockedIpv4(dottedMatch[1] ?? '');
  }

  const groups = expandIpv6(normalized);
  if (!groups) return true; // couldn't parse — block defensively

  // The fully-hex form of an IPv4-mapped address (what the WHATWG URL
  // parser normalizes "::ffff:a.b.c.d" to, e.g. "::ffff:7f00:1") — unwrap
  // and re-check against the IPv4 rules, or an attacker could smuggle a
  // blocked IPv4 target through what looks like an "IPv6" literal.
  if (groups.slice(0, 5).every((group) => group === '0000') && groups[5] === 'ffff') {
    const hi = parseInt(groups[6], 16);
    const lo = parseInt(groups[7], 16);
    const ipv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    return isBlockedIpv4(ipv4);
  }

  const first = parseInt(groups[0], 16);
  if (first >= 0xfe80 && first <= 0xfebf) return true; // fe80::/10 — link-local
  if (first >= 0xfc00 && first <= 0xfdff) return true; // fc00::/7 — unique local
  if (first >= 0xff00 && first <= 0xffff) return true; // ff00::/8 — multicast

  return false;
}

type Ipv6Groups = [string, string, string, string, string, string, string, string];

/**
 * Expands a (possibly "::"-compressed) IPv6 address into 8 lowercase,
 * zero-padded 16-bit hex groups, or returns null if it isn't well-formed.
 * Returning a fixed-length tuple (rather than plain `string[]`) means
 * every caller indexing a specific group — groups[0], groups[6], etc. —
 * gets a definite `string`, not `string | undefined`, since the exact
 * count is already proven here rather than re-asserted at every call
 * site.
 */
function expandIpv6(address: string): Ipv6Groups | null {
  const sides = address.split('::');
  if (sides.length > 2) return null;

  const headPart = sides[0] ?? '';
  const tailPart = sides.length === 2 ? sides[1] ?? '' : '';

  const head = headPart ? headPart.split(':') : [];
  const tail = sides.length === 2 && tailPart ? tailPart.split(':') : [];
  const missing = 8 - head.length - tail.length;

  if (sides.length === 1 && missing !== 0) return null; // no "::" but not exactly 8 groups
  if (missing < 0) return null;

  const filler = sides.length === 2 ? new Array(missing).fill('0') : [];
  const full = [...head, ...filler, ...tail];
  if (full.length !== 8 || full.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;

  return full.map((group) => group.padStart(4, '0')) as Ipv6Groups;
}

/**
 * fetch(), hardened for a user-supplied URL (section 57):
 *  - validates the URL and every redirect target via `resolveSafeUrl`
 *  - never lets `fetch` auto-follow a redirect; each hop is re-validated
 *    and re-fetched by hand instead (`redirect: 'manual'`)
 *  - aborts the request after `timeoutMs`
 *  - stops reading the response body the instant it would exceed
 *    `maxResponseBytes`, instead of buffering an unbounded response
 */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions): Promise<SafeFetchResult> {
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  let currentUrl = rawUrl;
  let method = options.method ?? 'GET';
  let body = options.body;

  for (let redirectCount = 0; ; redirectCount += 1) {
    const url = await resolveSafeUrl(currentUrl);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: options.headers,
        body: method === 'GET' || method === 'HEAD' ? undefined : body,
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) {
        throw new Error(`Request to "${url.hostname}" timed out after ${options.timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get('location');
      if (!location) {
        throw new NonRetryableJobError('Redirect response is missing a Location header');
      }
      if (redirectCount >= maxRedirects) {
        throw new NonRetryableJobError(`Too many redirects (max ${maxRedirects})`);
      }

      currentUrl = new URL(location, url).toString();
      // Matches fetch's own "follow" redirect semantics: a 303 always
      // downgrades to GET, and so does a 301/302 that started as a POST.
      if (
        response.status === 303 ||
        ((response.status === 301 || response.status === 302) && method === 'POST')
      ) {
        method = 'GET';
        body = undefined;
      }
      continue;
    }

    const responseBody = await readBodyWithLimit(response, options.maxResponseBytes);
    return { response, body: responseBody };
  }
}

async function readBodyWithLimit(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  // Bounded by the `break` below (stream end) or the throw inside the
  // loop (size exceeded) — never actually unconditional.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new NonRetryableJobError(
        `Response exceeded the maximum allowed size (${Math.round(maxBytes / (1024 * 1024))}MB)`,
      );
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf-8');
}
