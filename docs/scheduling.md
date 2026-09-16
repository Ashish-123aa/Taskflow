# Scheduled Jobs

Added in Phase 7. Covers `apps/api/src/scheduler/`, the `Schedule` CRUD
endpoints, and the `Schedule` model additions.

## Why the scheduler lives in the API process, not the worker

`node-cron` was originally declared as a worker dependency back in
Phase 1's upfront tech-stack setup, before scheduling was actually
designed. Phase 7 moves it to the API instead, for one concrete reason:
triggering a schedule means creating a new `Job` row and validating/
enqueuing it — exactly what `jobService.createJob` already does for
`POST /api/v1/jobs`, including per-job-type payload validation
(`JOB_PAYLOAD_SCHEMAS`) and publishing the `job:queued` real-time event
(`docs/realtime.md`). That logic lives in the API. Running the scheduler
in the worker instead would mean either duplicating all of that in a
second place, or having the worker reach across the process boundary to
call it — both worse than just running the (lightweight) cron tick
alongside the HTTP server it already needs.

This does not violate section 19's "do not execute the task directly
inside the scheduler" — the scheduler still never runs a job's actual
handler logic. It only creates a database row and calls the same
enqueue path a human hitting `POST /jobs` would use; the worker is still
the only thing that ever executes a handler.

## Why it's a one-minute poll, not a per-schedule timer

`startScheduler()` runs one `node-cron` tick every minute, checking
`Schedule` rows for `isActive: true AND nextRunAt <= now()` — it does not
set up an individual timer per schedule. Two reasons: standard 5-field
cron syntax (what `cronExpression` accepts) has no seconds field, so
minute-level granularity loses nothing a user could actually configure.
And a single poll scales trivially to however many schedules exist (one
indexed query — see `Schedule.@@index([nextRunAt])` from Phase 1's
database design), where a timer-per-schedule approach would need its own
bookkeeping to create/cancel timers as schedules are added, disabled, or
deleted.

## Why `nextRunAt` still advances after a failed trigger

If `jobService.createJob` throws during a trigger (e.g. a schedule's
stored payload no longer validates against its job type — maybe the
type's schema tightened after the schedule was created), the schedule's
`nextRunAt` still moves forward to the next real occurrence, and the
failure is recorded in a new `lastError` field rather than left silent.
The alternative — leaving `nextRunAt` in the past so the schedule gets
picked up again next tick — would mean a single permanently-broken
schedule gets retried every single minute forever, which is both useless
(the same error will recur) and needlessly noisy. This mirrors the
non-retryable-error philosophy from `docs/worker-system.md`: some
failures aren't worth hammering at.

## `Schedule` model additions in this phase

Three fields were added to `Schedule` (declared in the schema since
Phase 1, but only actually populated starting now):

- **`priority`** and **`maxAttempts`** — a scheduled job needs the same
  configuration a manually created one can have (section 12: configurable
  retries). Both are copied onto each `Job` a trigger creates, exactly as
  if a person had set them on a one-off `POST /jobs` call.
- **`lastError`** — set on a failed trigger, cleared on the next
  successful one. Without it, a broken schedule would only be
  diagnosable by cross-referencing worker/API logs against timestamps;
  with it, the schedule's own row says why it stopped producing jobs.

## Why `jobType` can't be changed via `PATCH`

`updateScheduleSchema` allows changing a schedule's name, payload, cron
expression, priority, `maxAttempts`, and active state — but not its job
type. Changing the type would mean re-validating the existing payload
against a completely different schema, and a payload that made sense for
`API_REQUEST` (a URL) has no sensible mapping onto, say, `EMAIL` (a
recipient and subject). Wanting a different job type on the same cadence
is a new schedule, not an edit to this one.

## Why schedules have no admin override

Like notifications (`docs/realtime.md`), `scheduleService` has no
`assertOwnership`-with-admin-bypass — section 5's admin capability list
doesn't mention schedules at all, so they stay strictly self-service, the
same way notifications do.
