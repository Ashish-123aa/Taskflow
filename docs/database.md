# Database Design

Schema source of truth: `packages/shared/prisma/schema.prisma`.

## Why the schema lives in `packages/shared`, not `apps/api`

Both the API and the Worker read and write the same tables — the API
creates a `Job` row and sets it to `QUEUED`; the Worker reads that row,
updates it to `RUNNING`, and eventually to `COMPLETED`. If the schema (and
generated Prisma Client) lived inside `apps/api`, the worker would need its
own copy, and the two could drift out of sync — a classic source of "works
on the API, breaks on the worker" bugs. Putting the schema in the shared
package means there is exactly one generated Prisma Client and one set of
TypeScript types, imported by both processes.

## Entity overview

```text
User ──1───N── Job ──1───N── JobAttempt
 │                │
 ├──1───N── Schedule
 ├──1───N── Notification ──N───1── Job
 └──1───N── AuditLog
```

- **User** — an account, with a role (`USER` / `ADMIN`) used for
  authorization checks, enforced server-side (see `docs/security.md`,
  added when auth is implemented).
- **Job** — a single unit of work: what to run (`type`), what to run it
  with (`payload`), how it's going (`status`, `progress`), and what came
  out of it (`result` / `error`).
- **JobAttempt** — one row per execution attempt of a Job. Without this,
  a retried job would just overwrite its own error message on each
  attempt, and the "Attempt 1 → Failed, Attempt 2 → Failed..." timeline
  the spec requires on the job details page would be impossible to render.
- **Schedule** — a cron-based recipe for creating new Jobs on a timer. A
  Schedule doesn't do work itself; the scheduler (part of the API process
  as of Phase 7 — see `docs/scheduling.md`) reads active schedules, and
  when `nextRunAt` has passed, creates a new `Job` and lets the normal
  queue/worker path pick it up — same as any manually created job.
  `priority`, `maxAttempts`, and `lastError` were added to this model in
  Phase 7, once scheduling was actually implemented; they didn't exist
  when the schema was first designed in Phase 1.
- **Notification** — an in-app notification, optionally tied to the Job
  that triggered it. `jobId` is nullable and `onDelete: SetNull` because a
  notification like "job X was deleted" should still exist even after the
  job itself is gone.
- **AuditLog** — a record of significant actions (job cancelled by admin,
  user disabled, etc.), independent of whether the acting user's account
  still exists later.

## Notable design decisions

**Why is `Job.type` a plain string, not a Postgres enum?**
The spec explicitly requires that "the architecture must make it easy to
add new job types later" (section 3). A Postgres enum (`CREATE TYPE ...`)
requires a schema migration every time a new value is added — safe, but
heavyweight for something that should be as easy as "write a new handler
class." Instead, `type` is a `String` column, and the *set of currently
valid types* is enforced in the application layer: a single TypeScript
const array (`packages/shared/src/constants/job-types.ts`) that the Zod
validation schema and the worker's handler registry both read from. Adding
a job type becomes: add one array entry, one payload schema, one handler
class — no migration. `JobStatus` and `JobPriority`, by contrast, *are*
Postgres enums, because those value sets are part of the core state
machine and are not expected to change without a corresponding code change
anyway.

**Why `payload` / `result` are `Json`, not per-type columns**
Every job type needs different input and output shapes (a CSV job's result
looks nothing like an email job's result). Modeling that with real columns
would mean either one enormous table with dozens of mostly-null columns,
or a separate table per job type with duplicated status/timestamp/attempt
tracking in each. A single `Json` column keeps one unified `Job` table
(so dashboard aggregate queries stay simple) while letting each handler
define and validate its own shape at the application layer with Zod.

**Why UUIDs (`@default(uuid())`) instead of auto-incrementing integers**
Job IDs are returned directly to the client in the job-creation response
and appear in URLs (`/jobs/:id`). Sequential integer IDs leak information
(total job count, creation order across all users) and make IDs guessable
across users. UUIDs avoid both, at a small storage cost that's irrelevant
at this scale.

**Why explicit `@@index(...)` on foreign keys and filter columns**
Postgres does *not* automatically index foreign key columns (unlike some
other databases). Every index in the schema maps to a specific query the
spec requires — see the inline comments in `schema.prisma` next to each
`@@index`. Indexes aren't free (they slow down writes and cost storage),
so each one here is deliberate, tied to a named feature, not
"index everything defensively."

**Why `onDelete: Cascade` on Job/JobAttempt/Schedule/Notification, but
`onDelete: SetNull` on AuditLog's user relation**
If a user account is deleted, their jobs, attempts, schedules, and
notifications are personal data with no meaning independent of that
account — cascading delete keeps the database consistent. An audit log
entry, though, exists specifically to answer "what happened," and that
question should still be answerable after the account that did it is
gone — so the log row survives with `userId` set to `null` instead of
being deleted.

## Running migrations (once Postgres is up via `docker compose up -d postgres`)

```bash
npm run prisma:generate   # generates the Prisma Client from schema.prisma
npm run prisma:migrate    # creates and applies a migration, e.g. "init"
npm run prisma:studio     # opens Prisma Studio to browse the tables
```

> Note: this schema was written and reviewed for correctness, but live
> `prisma validate`/`migrate` could not be executed inside the sandbox this
> was generated in — its egress allowlist doesn't include Prisma's engine
> binary CDN (`binaries.prisma.sh`). Run the commands above in your own
> environment to generate the client and apply the first migration; nothing
> about that step is expected to fail, but it hasn't been mechanically
> verified end-to-end yet.
