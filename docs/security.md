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

## External API job — SSRF protection status (Phase 3 note)

The `API_REQUEST` handler introduced in Phase 3
(`apps/worker/src/jobs/handlers/api-request.handler.ts`) makes outbound
HTTP requests to a URL supplied in the job payload, with **no SSRF
protection yet** — it does not block `localhost`, private IP ranges, or
cloud metadata endpoints, and has no request timeout or response size cap
(section 57 requires all of this). It's fine to use against the
recommended free public APIs (Open-Meteo, REST Countries, JSONPlaceholder)
today, but is **not** safe to expose to arbitrary user-supplied URLs until
the security-hardening phase adds URL validation, timeouts, response size
limits, and redirect limits. This is a known, tracked gap — called out
here so it stays a visible item on the roadmap rather than a silent one.
