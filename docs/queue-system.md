# Queue System

Added in Phase 3. Covers what BullMQ is configured to do and why.

## What goes on the queue — and what doesn't

The BullMQ job payload (`packages/shared/src/queue/job-data.ts`) is
deliberately tiny: just `{ jobId, type }`. The job's actual payload,
current status, attempt count, and everything else already live in
Postgres, written when the API creates the row. The worker's first step
(`apps/worker/src/workers/job.worker.ts`) is always to re-fetch the full
row from Postgres by `jobId`.

Why not put the whole payload directly on the queue and save that extra
database read? Two reasons:

1. Postgres is the single source of truth for job state everywhere else in
   the system — the dashboard, the admin panel, a manual retry. If the
   queue carried its own copy of the payload, a manual retry or an edited
   payload would need to keep two copies in sync instead of one.
2. BullMQ job data has to be small and JSON-serializable and lives in
   Redis's memory. A 500,000-row CSV's worth of data, or a large report
   payload, has no business being duplicated into Redis just to describe
   what to do.

## Priority mapping

TaskFlow's domain priorities read `LOW < MEDIUM < HIGH < CRITICAL` — higher
word, runs first, intuitively. BullMQ's own `priority` option is the
opposite: a **lower** number is processed first. `toBullMQPriority()`
(`packages/shared/src/queue/priority.ts`) is the one place that inversion
is handled, so nothing else in the codebase has to remember BullMQ's
convention when enqueuing a job.

## Retries and backoff

Every job is enqueued with `attempts: job.maxAttempts` and
`backoff: { type: 'exponential', delay: 2000 }`. BullMQ handles the actual
scheduling of the next attempt after a growing delay — TaskFlow's own code
never manually re-queues a failed job. When a handler throws an error that
should never be retried (section 12), the worker translates it into
BullMQ's built-in `UnrecoverableError`, which tells BullMQ to skip the
remaining configured attempts entirely, regardless of how many are left.
See `docs/worker-system.md` for how that classification happens.

## Why the queue payload is re-validated against `job.maxAttempts` from Postgres, not a fixed number

`attempts` on the BullMQ job options is set from `job.maxAttempts` at
enqueue time. As of Phase 5, `maxAttempts` is configurable per job at
creation time (bounded 1–10 by `createJobSchema`) rather than always the
schema's default of 3 — a caller who knows a particular external API is
flaky can ask for more retries; one who knows a failure is unlikely to be
transient can ask for fewer. This is exactly why `attempts` is read from
the database at enqueue time instead of hardcoded into queue setup: the
retry count is data, not configuration.

## Two attempt counters, on purpose

Once manual retries exist (below), a single "attempt number" isn't
enough — `apps/worker/src/workers/job.worker.ts` deliberately tracks two:

- **`attemptNumber`** — lifetime-cumulative, computed as `job.attempts + 1`
  from Postgres. This only ever goes up, including across a manual retry.
  It's what `JobAttempt` rows are numbered by, so the job details timeline
  (section 22: "Attempt 1 → Failed, Attempt 2 → Failed...") stays a
  complete, non-colliding history across the job's entire life, not just
  its current retry cycle.
- **`cycleAttemptsMade` / `cycleMaxAttempts`** — BullMQ's own
  `bullJob.attemptsMade` and `bullJob.opts.attempts` for *this specific
  BullMQ job instance*. These legitimately reset to 0 / whatever ceiling
  was configured whenever a new instance is added to the queue — which is
  exactly what a manual retry does (see below). This pair is what decides
  whether a given failure is terminal (`RETRYING` vs. `FAILED`/
  `DEAD_LETTER`), not the lifetime counter.

Conflating these two was an actual bug in the Phase 3/4 implementation:
using `bullJob.attemptsMade + 1` for the `JobAttempt` row number meant a
manually-retried job's new attempts would restart at 1, colliding with
`JobAttempt` rows already created during its first retry cycle. Fixed in
Phase 5 by sourcing `attemptNumber` from Postgres instead of from BullMQ's
per-instance counter.

## Manual retries: a fresh cycle, not an extension

`POST /jobs/:id/retry` (`jobService.retryJob`) grants the job a **new,
full attempts budget**, not "one more try tacked onto the exhausted one."
Concretely: a job with `maxAttempts: 3` that dead-letters after 3 failed
attempts, then gets manually retried, is enqueued as a new BullMQ job
instance with `attempts: 3` again (or a caller-supplied override — see
below) — not `attempts: 0` (which would mean it can't retry at all) and
not some running total against a single shared budget across cycles.

This is a deliberate simplification over trying to track one unified
lifetime attempts-budget across every manual retry: "give it another full
cycle" is simple to reason about, simple to implement correctly (see "two
attempt counters" above), and matches how a person actually thinks about
clicking "retry" on a permanently-failed job — they want it to genuinely
try again, not to inherit however many attempts happen to be left over
from a completely different failure.

### Overriding `maxAttempts` on retry

`POST /jobs/:id/retry` accepts an optional body,
`{ "maxAttempts": <1-10> }`. Omitting it retries at the job's existing
`maxAttempts`; providing it sets a new ceiling for this fresh cycle (and
persists it to `Job.maxAttempts`, so it's reflected everywhere else the
job's data is read). This is available to a job's owner and to an admin
retrying someone else's dead-lettered job — an admin who's confident a
downstream outage has resolved can grant more attempts without waiting
for the owner to do it themselves.

## Job removal defaults

`removeOnComplete`/`removeOnFail` are set on the queue's default job
options (`apps/api/src/queues/job.queue.ts`) so BullMQ's own Redis-side
bookkeeping doesn't grow unbounded. Postgres already keeps the durable,
queryable history via `Job` and `JobAttempt` — BullMQ's copy of a
finished job is disposable once it's done its job of actually running the
work.
