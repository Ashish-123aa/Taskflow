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

There is no admin-facing endpoint to *read* the audit log yet — the
repository (`auditLogRepository.findAll`) exists, but wiring it up to a
route is deferred to the observability phase (Phase 10), alongside admin
metrics and worker status, rather than added piecemeal here.
