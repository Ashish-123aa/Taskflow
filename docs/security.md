# Security

> Added in Phase 2 (authentication). Grows in later phases as rate
> limiting, SSRF protection, and file-upload validation are built —
> those sections will be appended here, not written speculatively now.

## Password storage

Passwords are hashed with bcrypt at 12 salt rounds before ever touching
the database (`apps/api/src/services/auth.service.ts`) — `passwordHash` is
the only thing persisted, and it never appears in any API response.
`SafeUser` (`packages/shared/src/types/auth.ts`) is built field-by-field
rather than by spreading the Prisma row and deleting `passwordHash`, so a
new sensitive column added to `User` later can't accidentally leak into a
response just because someone forgot to add it to an "omit" list.

12 rounds is a deliberate balance: expensive enough to make brute-forcing
a stolen hash database impractical, cheap enough that login latency stays
well under human-perceptible delay on ordinary hardware.

## Why the JWT lives in an httpOnly cookie, not localStorage

A token in `localStorage` is readable by any JavaScript running on the
page — including an injected XSS payload. An httpOnly cookie is invisible
to JavaScript entirely; only the browser attaches it automatically to
requests against the API's origin. `secure: true` in production means it's
only ever sent over HTTPS, and `sameSite: 'lax'` blocks the cookie from
being sent on cross-site POST requests (the common CSRF vector) without
breaking normal top-level navigation.

## Why login returns an identical error for "no such user" and "wrong password"

If those two cases returned different errors, an attacker could enumerate
which emails have accounts on the system just by attempting logins and
watching which error comes back. Returning the same
`"Invalid email or password"` either way closes that side channel, at the
minor UX cost of not telling a genuine user which part they got wrong.

## The stateless-JWT trade-off

There's no server-side session table — the JWT itself is the session. That
keeps every authenticated request to a single signature check with no
database round-trip, but it means `/auth/logout` can only clear the
cookie holding the token; it cannot force an already-issued token to stop
verifying before it naturally expires. If that token were somehow copied
out of the httpOnly cookie before logout, it would keep working until it
expired regardless.

This is a known, accepted trade-off for the current scope, not an
oversight: true server-side revocation would mean checking a stored
token/session table on every request, adding both a database round-trip
per request and a table to keep clean. It's called out explicitly here so
it stays a deliberate decision that can be revisited (e.g. a short-lived
access token plus a rotated, DB-backed refresh token) if the project's
threat model calls for it later.

The same trade-off means a **role change doesn't take effect until the
next login**, not immediately: the JWT's `role` claim is fixed at sign
time, and `authorize(...)` reads that claim rather than re-querying the
database on every request. Promoting a user to `ADMIN` (see
`docs/admin.md`) updates the database immediately, but that user's
existing session keeps behaving like whatever role it was issued with
until they log in again.

## RBAC enforcement

Role checks happen in exactly one place — `authorize(...roles)` in
`apps/api/src/middleware/auth.ts` — applied to every route that needs a
specific role, always after `authenticate`. The frontend may also hide
UI elements based on role as a UX nicety, but that is never the actual
authorization boundary: a request can always be sent directly, bypassing
whatever the UI does or doesn't show, so the backend check is the only one
that counts (section 5: "Never rely only on frontend role checks").

## External API job — SSRF protection (Phase 9)

The `API_REQUEST`/`SCHEDULED_API_FETCH` handler
(`apps/worker/src/jobs/handlers/api-request.handler.ts`) builds an
outbound HTTP request from a URL the *user* supplies. Through Phase 8
this made that request with the bare global `fetch` and no validation at
all — meaning TaskFlow itself was usable as a proxy to reach whatever
network the worker container could see. Phase 9 closes this with a
dedicated guard, `apps/worker/src/utils/ssrf-guard.ts`, and every
outbound call from this handler now goes through it instead:

- **Protocol allowlist.** Only `http:`/`https:` are accepted — `file://`,
  `ftp://`, `gopher://`, etc. are rejected outright. This is checked
  twice: cheaply and synchronously at job-*creation* time in
  `apiRequestPayloadSchema` (`packages/shared/src/schemas/job-payloads.ts`,
  giving an immediate 400), and again — authoritatively — by the worker
  right before it makes the request.
- **Address blocking.** Loopback (`127.0.0.0/8`, `::1`), private
  (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, IPv6 unique-local),
  link-local (`169.254.0.0/16`, including the `169.254.169.254` cloud
  metadata address, and IPv6 `fe80::/10`), and the usual reserved/
  benchmarking/documentation ranges (`0.0.0.0/8`, `100.64.0.0/10`,
  TEST-NET-1/2/3, multicast, broadcast) are all blocked, for both IP
  literals in the URL and hostnames resolved via DNS. `localhost` is
  blocked by name outright. IPv4-mapped IPv6 addresses
  (`::ffff:127.0.0.1`) are unwrapped and checked against the same IPv4
  rules, so that form can't be used to smuggle a blocked target through
  what looks like a distinct address family. The WHATWG URL parser
  itself already canonicalizes shorthand/octal/hex/decimal-encoded IPv4
  hostnames (`127.1`, `0x7f000001`, `2130706433`) into plain
  dotted-decimal before the guard ever sees them, closing that
  particular family of bypass without any extra decoding logic.
- **Redirects are handled by hand, not auto-followed.** `safeFetch` sets
  `redirect: 'manual'` and re-runs the full validation above against
  every redirect target before following it (bounded by a configurable
  redirect limit) — otherwise a URL that passes validation could simply
  302 to `http://169.254.169.254/` and the bare `fetch` would follow it
  without another check.
- **Timeout and response-size cap.** Every request is aborted after
  `EXTERNAL_REQUEST_TIMEOUT_MS` (default 10s), and the response body is
  read via a streaming reader that stops — and fails the job — the
  instant it would exceed `EXTERNAL_MAX_RESPONSE_SIZE_MB` (default 5MB),
  rather than buffering an unbounded response into memory. Both are
  worker env vars (`apps/worker/src/config/env.ts`) — they existed in
  `.env.example` and the API's own env schema since earlier phases but
  were never actually read by anything, since the API never makes this
  call; the worker does.
- **Safe error messages.** Every rejection from the guard is a generic
  `NonRetryableJobError` ("This URL points to a network address TaskFlow
  is not allowed to reach") — it never echoes back which range, or which
  resolved address, actually tripped the check.

**Known limitation, documented rather than silently assumed away:** the
guard resolves a hostname, validates every address it returns, and only
*then* lets `fetch` open its own connection — which re-resolves the
hostname independently a moment later. A DNS record that changes in that
narrow window (classic "DNS rebinding") could in principle slip past this
check. Fully closing that requires pinning the exact validated IP to the
TCP connection `fetch` actually opens (a custom connect/dispatcher hook),
which is meaningfully more machinery than this guard takes on. Re-
resolving and re-validating on every redirect — with the DNS lookup
happening immediately before the request it gates, rather than once at
job-creation time — keeps the exploitation window as small as practical
without that extra layer.

## Rate limiting (Phase 9)

Section 25 asks for three budgets — authentication attempts, general API
traffic, and job creation — enforced with Redis. `apps/api/src/middleware/rateLimit.ts`
implements the mechanism; `apps/api/src/middleware/rateLimiters.ts` wires
up the three concrete instances the spec names, from configurable env
vars (`RATE_LIMIT_AUTH_MAX`/`_WINDOW_MS`, `RATE_LIMIT_API_MAX`/`_WINDOW_MS`,
`RATE_LIMIT_JOB_CREATE_MAX`/`_WINDOW_MS`):

| Limiter | Budget (default) | Keyed by | Applied to |
|---|---|---|---|
| `authRateLimiter` | 5 / minute | IP | `POST /auth/register`, `POST /auth/login` |
| `apiRateLimiter` | 100 / minute | IP | every route under `/api/v1` (mounted once in `app.ts`) |
| `jobCreateRateLimiter` | 20 / minute | authenticated user ID | `POST /jobs`, `POST /jobs/upload/csv`, `POST /jobs/upload/image` |

The auth and job-creation limiters are deliberately layered *inside* the
general API one, not a replacement for it — a request to `POST
/auth/login` is checked against both budgets, since they answer
different questions ("is this IP hammering the API in general" vs. "is
this IP specifically hammering login").

**Why keyed by IP for auth/general, but by user ID for job creation.**
Register and login happen before there's any session to key on, so IP is
the only option. The general limiter is mounted ahead of every route,
including ones that go on to require auth, so by the time it runs
nothing has verified who (if anyone) is logged in yet — it stays IP-keyed
too. Job creation, by contrast, only ever runs after `authenticate` has
already populated `req.user` (job.routes.ts applies that to the whole
router first), so it's keyed by account instead — otherwise everyone
behind the same office NAT or corporate proxy would share one 20/minute
budget regardless of how many separate accounts they're using.

**Why a Lua script, not a plain INCR + EXPIRE.** A fixed-window counter
needs to increment on every request but only ever set the key's expiry
once, the very first time it's created — that "increment, then
conditionally expire" has to be one atomic Redis round trip. Two separate
commands leave a window (a crash, or just ordinary concurrent requests,
landing between them) where a key could end up with no expiry at all — a
counter that never resets — or have its expiry pushed back on every
single request — a window that never actually closes. `createRedisRateLimitCounter`
registers a two-line Lua script via ioredis's `defineCommand` for exactly
this; `apps/api/tests/rateLimitRedisCounter.test.ts` verifies both the
atomicity (25 concurrent increments against one key produce 25 distinct,
gapless values) and the TTL behavior (an expiry set once, never reset)
against a real Redis instance.

**A fixed window, not a sliding one — a known, accepted imprecision.**
"20 per minute" here means 20 within whichever wall-clock minute Redis's
own EXPIRE happens to land on for that key, not 20 within any rolling
60-second span. A burst straddling a window boundary (a few requests
just before the reset, a few more right after) can therefore exceed the
stated rate over a short span spanning two windows. That's fine for
coarse abuse/brute-force protection — which is what all three of these
budgets are for — and meaningfully simpler to implement and reason about
than a sliding window (e.g. a Redis sorted set of timestamps, trimmed on
every check). Worth revisiting only if one of these limits ever needs to
be exact rather than approximate.

**Fails open, not closed.** If the counter itself throws — Redis is
briefly unreachable — the middleware logs a warning and lets the request
through uncounted, rather than turning a Redis hiccup into a site-wide
500 on every single request. This is a deliberate reading of section 55's
"Redis unavailable" failure scenario: keeping the app up matters more
than perfectly enforcing a rate limit during a brief outage.

**Response shape.** An exceeded limit is a `TooManyRequestsError`
(`apps/api/src/utils/errors.ts`), passed to `next()` like any other typed
error, so it flows through the existing centralized error handler and
comes back as the same `{ success: false, message, errorCode }` shape
every other error in the app uses — `errorCode: 'TOO_MANY_REQUESTS'`,
HTTP 429. Every response, limited or not, also carries `RateLimit-Limit`
and `RateLimit-Remaining`; a 429 additionally carries `Retry-After`.

## Caching (Phase 9)

Section 26 asks for Redis caching on read-heavy endpoints, starting with
`GET /dashboard/stats` — four Prisma aggregate/groupBy queries run on
every dashboard page load, for data that doesn't need to be
millisecond-fresh. `apps/api/src/utils/cache.ts` provides a small,
generic `Cache` (JSON-serializing get/set/del over Redis, not tied to
dashboard stats specifically — "caching where useful" implies more than
one endpoint eventually); `apps/api/src/services/dashboardCache.ts`
wraps it with the policy specific to this one resource.

**Scoped per user, deliberately.** The cache key is `cache:dashboard-stats:<userId>`,
never a shared or global key — `dashboardService.getStats` was already
scoped to the requesting user's own jobs before caching existed
(`jobRepository.getStats(userId, ...)`), and the cache has to preserve
that boundary or one account's numbers could leak into another's
response the moment two different users' requests happened to land on
the same key. `tests/dashboardCache.test.ts` asserts this directly: two
users' cached stats stay independent, and invalidating one never touches
the other.

**TTL, not just invalidation.** `DASHBOARD_STATS_CACHE_TTL_SECONDS`
(default 30) is a safety net under the invalidation described below, not
a replacement for it — if an invalidation is ever missed (a bug, a
process that crashes between the mutation and the invalidation call),
the absolute worst case is stale numbers for up to the TTL, never
forever.

**Real invalidation, not just a short TTL.** A job's status changing is
exactly the kind of "relevant data changes" section 9.3 asks the cache to
react to, and TaskFlow already has a single channel that every job-status
transition flows through regardless of which process caused it: the
Redis pub/sub bridge from `docs/realtime.md`. `websocket/socket.ts`'s
subscriber — the one place in the API process that hears about every
`job:*` event, whether the API published it (create, cancel, retry) or
the worker did (started, completed, failed, retrying, dead-lettered) —
invalidates that event's `userId` on every event except `job:progress`
(a progress tick never changes any of the counts or aggregates the
dashboard shows, since the job was already "running" immediately before
and after it — invalidating on every one would defeat the cache for any
user with an active job, for no real benefit). The one mutation that
doesn't publish a job event at all — `jobService.deleteJob`, since
there's nothing left to send a WebSocket update about — invalidates
directly instead, right after the delete succeeds.

**Handling a Redis failure — the same "fail open" posture as rate
limiting.** `createDashboardStatsCache`'s `get`/`set`/`invalidate` all
catch and log rather than throw. A Redis outage degrades
`GET /dashboard/stats` to "always compute it live from Postgres" — slower,
not broken — the same reasoning as the rate limiter's own graceful
degradation, and, like the rate limiter, kept out of the low-level
`Cache` implementation itself and placed at the point that actually knows
what "gracefully" should mean for this resource (`tests/dashboardCache.test.ts`
verifies this against a `Cache` that deliberately fails every call).
