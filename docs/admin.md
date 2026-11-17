# Admin Capabilities

Added in Phase 5. Covers `GET /api/v1/admin/jobs`,
`GET /api/v1/admin/users`, and `PATCH /api/v1/admin/users/:id`.

## Why `/jobs` and `/admin/jobs` are separate endpoints, not one role-branched endpoint

Through Phase 4, `GET /api/v1/jobs` returned every job in the system when
the requester was an admin, and only the requester's own jobs otherwise —
one endpoint, branching on role. Phase 5 changes this: `GET /jobs` now
**always** means "my jobs," for every account including admins, and the
global cross-user view lives at `GET /admin/jobs` instead.

Two reasons this is worth the extra endpoint:

1. **"My jobs" should mean the same thing for everyone.** An admin
   building their own automation (creating jobs for themselves, same as
   any user) wants their personal job list to actually be personal — not
   suddenly showing every user's jobs because of the role on their
   account. Section 32's frontend page list backs this up: `/jobs` and
   `/admin/jobs` are listed as two different pages, not one page with
   different content depending on who's looking.
2. **A route-level gate is a stronger guarantee than a service-level
   branch.** `adminRoutes` applies `authorize('ADMIN')` to every route in
   the file, so "can a non-admin ever reach this data" is answerable by
   reading one `router.use(...)` line. A branch inside `jobService.listJobs`
   answering the same question requires reading the service logic itself
   — easy to get right once, easier to accidentally regress later (e.g.
   a new caller of `listJobs` that forgets the role check exists).

Individual job *actions* (cancel, retry, view, delete on a specific job
by ID) are **not** duplicated under `/admin/jobs/:id/...` — an admin uses
the exact same `POST /jobs/:id/cancel` and `POST /jobs/:id/retry` any user
does. `jobService`'s `assertOwnership` already permits an admin past the
ownership check for any single job it looks up by ID (unchanged since
Phase 3). The `/admin/jobs` listing is what surfaces *which* IDs an admin
might want to act on — a dead-lettered job belonging to someone else,
found via `GET /admin/jobs?status=DEAD_LETTER` (satisfying section 13:
"Admin users should be able to inspect dead-letter jobs"), acted on via
the same endpoint everyone else uses.

## Why user listing uses Prisma's `select`, not "fetch then delete the field"

`userRepository.findAll` and `.setActive` both use an explicit Prisma
`select` that lists every field except `passwordHash`, rather than
fetching the full row and stripping the hash out of the response object
afterward. The difference matters: with `select`, the hash is never
retrieved from the database at all — there's no intermediate object with
a real password hash sitting in memory that a future refactor could
accidentally serialize. This is the same principle behind
`SafeUser`/`toSafeUser` in `docs/security.md`, applied at the query layer
instead of the response-shaping layer.

## Why an admin can't disable their own account

`adminService.setUserActive` explicitly refuses a request where the
target user is the acting admin and `isActive` is `false`. Without this,
an admin could lock themselves out with no recovery path short of another
admin's help or direct database access — a mistake that's easy to make
(wrong ID pasted, testing in the wrong environment) and disproportionately
annoying to undo. Refusing it outright costs nothing in the case where it
really was intentional (another admin account can still do it), and saves
the accidental-lockout case entirely.

## Why a role change requires logging in again to take effect

Promoting a user to `ADMIN` (currently only done directly in the database
— there's no self-service "become an admin" endpoint, deliberately) does
not retroactively change what an *already-issued* JWT can do. The token's
`role` claim is fixed at the moment it was signed; `authorize('ADMIN')`
reads that claim, not a fresh database lookup, for the same reason
described in `docs/security.md`'s "stateless JWT trade-off" — no
per-request database round-trip. A user (or a test, or an admin
promoting themselves via direct database access for local development)
needs to log in again after a role change for the new role to actually
take effect.

## Audit logging

`AuditLog` (in the schema since Phase 1's database design) is used for
the first time in Phase 5, specifically for actions where someone acts on
a resource that isn't theirs: an admin disabling/enabling a user account,
or an admin cancelling/retrying a job it doesn't own. A user managing
their own jobs or account doesn't generate an audit entry — they can
already see their own activity without one. `isAdminOverride()` in
`job.service.ts` is the one-line check ("is the requester an admin AND
not the resource's owner") that decides whether an action gets logged;
see `apps/api/tests/admin.test.ts` for the corresponding test that a
user cancelling their *own* job does **not** produce a log entry, only a
genuine cross-user override does.

## Reading the audit log — `GET /admin/audit-logs` (Phase 10.2)

The repository method (`auditLogRepository.findAll`) existed since Phase
5 — every admin override was already being recorded — but nothing read
it back until Phase 10.2 wired it up to a route, gated by the same
`authorize('ADMIN')` check every other route in this file uses. No new
authorization logic was needed: an audit log entry isn't "owned" by
anyone the way a job or a user account is, so there's no per-row
ownership check to write, only the existing route-level admin gate.

Supports the same pagination shape as `/admin/jobs` and `/admin/users`
(`page`, `limit`, capped at 100), plus filtering and sorting:

- **`userId`** — the *acting* admin, not a target. Every `AuditLog` row's
  `userId` is whoever performed the action (`auditLogRepository.record`
  is always called with `actingAdminId`, never the person being acted
  on) — this filter answers "what has this admin done," not "what has
  happened to this user."
- **`resource`** / **`resourceId`** — what was acted on (e.g. `resource:
  "Job"`, `resourceId: <a specific job's id>`), for "show me everything
  that happened to this one resource."
- **`action`** — the exact recorded action string (`USER_ENABLED`,
  `USER_DISABLED`, `ADMIN_JOB_CANCEL`, `ADMIN_JOB_RETRY` today; a new
  admin-override action added later needs no schema change here, the
  same way `Job.type` needs none — see `docs/database.md`).
- **`fromDate`** / **`toDate`** — bounds on `createdAt`, coerced the same
  way `REPORT_GENERATION`'s payload schema coerces its own date range.
- **`sortOrder`** — `asc` or `desc` on `createdAt`, default `desc` (most
  recent first, matching every other list endpoint in this app).

The filter-combining logic (`buildAuditLogWhereClause` in
`repositories/audit.repository.ts`) is pulled out as its own pure
function, the same reasoning as `handlers/report-format.ts` on the worker
side: the part of this feature that needs a live database and the part
that's pure "which Prisma `where` clause does this combination of
filters produce" logic don't have to be tested together just because
they're called together — see `apps/api/tests/auditLog.test.ts`, which
exercises the filter combinations directly with no database involved.

**Response shape stays close to the raw model** — `id`, `userId`,
`action`, `resource`, `resourceId`, `metadata`, `createdAt` — deliberately
not joined against the `User` table to also return the acting admin's
name or email. Every admin viewing this list already has `/admin/users`
available to look up any `userId` they need more detail on; adding an
unconditional join here would mean this endpoint routinely returns more
than what it's actually for, for every request, whether or not the
caller wanted it.
