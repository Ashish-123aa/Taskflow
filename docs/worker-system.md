# Worker System

Added in Phase 3.

## The handler registry pattern

`apps/worker/src/jobs/registry.ts` maps a job `type` string to a
`JobHandler` implementation. The worker's processor function
(`apps/worker/src/workers/job.worker.ts`) never has a switch statement or
if/else chain over job types — it looks the handler up by `job.type` and
calls `.execute()`. Adding a new job type is: implement `JobHandler`,
register it once in `apps/worker/src/jobs/index.ts`. Nothing in the
worker's core processing loop changes (section 3: "the architecture must
make it easy to add new job types later").

As of Phase 4, **every** job type in `JOB_TYPES` has a real handler:

| Type | Handler | Notes |
|---|---|---|
| `API_REQUEST` | `api-request.handler.ts` | Fetches a URL, stores the response — the spec's own end-to-end walkthrough (section 63) |
| `SCHEDULED_API_FETCH` | *(same as `API_REQUEST`)* | Identical work, different creator — see below |
| `CSV_PROCESSING` | `csv-processing.handler.ts` | Streams the file (never loads it fully into memory), counts valid/invalid rows |
| `EMAIL` | `email.handler.ts` | SMTP via an injected `Transporter` — see below |
| `IMAGE_PROCESSING` | `image-processing.handler.ts` | Resize/reformat via `sharp` |
| `REPORT_GENERATION` | `report-generation.handler.ts` | Aggregates the caller's own job history into a downloadable CSV |
| `DATA_TRANSFORMATION` | `data-transformation.handler.ts` | A small pure filter/map/sort pipeline, no I/O at all |

### Why `SCHEDULED_API_FETCH` has no handler file of its own

It performs the exact same work as `API_REQUEST` — fetch a URL, store the
response. The only difference is *who creates the job*: a user directly
via `POST /jobs`, versus the scheduler creating one automatically on a
cron timer once Phase 7 exists. What the worker actually does with the
job once it's queued is identical either way, so
`apps/worker/src/jobs/index.ts` registers `apiRequestHandler` under both
type keys rather than maintaining two copies of the same logic.

### Why the EMAIL handler's transporter is injected, not constructed inline

`createEmailHandler(transporter)` takes its SMTP transporter as a
parameter instead of building one internally from env vars. Production
wiring (`jobs/index.ts`) passes a real SMTP transporter pointed at MailHog
locally; `tests/email.handler.test.ts` passes nodemailer's built-in
`jsonTransport`, which validates and "sends" a message entirely in memory
with no network call at all. This is what makes the handler's actual
logic (address validation, non-retryable classification) testable without
a running SMTP server.

Independent of which handler runs, `job.worker.ts` always:

1. Re-fetches the full `Job` row from Postgres by the `jobId` carried on
   the BullMQ job's data (see `docs/queue-system.md`).
2. Writes a `JobAttempt` row and flips `Job.status` to `RUNNING` *before*
   calling the handler — so a crash mid-execution still leaves an
   accurate attempt record instead of silence. The attempt number used
   here is lifetime-cumulative, not scoped to the current retry cycle —
   see `docs/queue-system.md` ("Two attempt counters, on purpose") for
   why that distinction exists and what bug it fixes.
3. Calls the handler, passing an `updateProgress()` callback the handler
   can invoke as often as it likes. That callback writes to both
   `Job.progress` in Postgres and BullMQ's own progress tracking, so
   progress is visible whether something is reading the database or
   listening to BullMQ directly.
4. On success: writes the handler's return value to `Job.result`, marks
   the job `COMPLETED`, and updates the matching `JobAttempt` to
   `SUCCEEDED`.
5. On failure: classifies the failure (below) and writes the appropriate
   status, then re-throws so BullMQ's own retry/backoff — or immediate
   stop, for non-retryable errors — takes over.

This means an individual handler never touches Postgres for
status/attempt bookkeeping — it only returns a result or throws. That
keeps handler code focused purely on "how do I do this specific kind of
work," and keeps all state-machine logic in exactly one place.

## FAILED vs. RETRYING vs. DEAD_LETTER

Three different outcomes of a failed attempt, deliberately distinct:

- **RETRYING** — the handler threw, but attempts remain and the error
  wasn't marked non-retryable. BullMQ will run it again after the
  configured backoff delay.
- **DEAD_LETTER** — the handler threw on the final configured attempt,
  *and* the job was actually configured to retry (`maxAttempts > 1`). It
  went through the retry cycle and fell out the other end — this is what
  the admin dead-letter view (section 13) is for.
- **FAILED** — either the job was never configured to retry
  (`maxAttempts <= 1`, so it never entered a retry cycle to fall out of),
  or the handler threw a `NonRetryableJobError` (section 12: a malformed
  request or bad input that would fail identically on every attempt, so
  there was no real "retry cycle" — it just failed once, permanently).
  Keeping this distinct from `DEAD_LETTER` means the admin dead-letter
  view only ever shows jobs that genuinely exhausted retries, not jobs
  that were never going to succeed no matter how many attempts they got.

## Error classification: `NonRetryableJobError`

Handlers throw a plain `Error` for anything that might succeed on a
retry — a network blip, a target API's temporary 5xx. For an error that
will provably fail the exact same way every time — bad input, a malformed
URL — a handler throws `NonRetryableJobError`
(`apps/worker/src/utils/errors.ts`) instead. The worker's processor
function catches that specifically and translates it into BullMQ's own
`UnrecoverableError`, which tells BullMQ to stop retrying immediately,
regardless of the job's configured `attempts`.

Handlers never import BullMQ directly — this translation happens exactly
once, in the worker's processor function, which keeps handler code
queue-implementation-agnostic and easy to unit test in isolation (see
`apps/worker/tests/api-request.handler.test.ts`, which tests the handler
with a mocked `fetch` and no real queue or database at all).

## Keeping handlers testable when they touch a database

`REPORT_GENERATION` needs Prisma to aggregate the caller's job history —
that part genuinely can't be unit tested without a real Postgres
connection. But turning that aggregated data into the actual downloadable
CSV is pure string formatting with no database involved, so it's pulled
out into its own module, `handlers/report-format.ts`, with zero imports
from `@taskflow/shared` (which would otherwise pull in a live
`PrismaClient` the moment it's imported). `report-generation.handler.ts`
imports and re-exports it for convenience, but
`tests/report-generation.format.test.ts` imports directly from
`report-format.ts`, so it never touches Prisma at all. The general
pattern — separate "the part that needs live infrastructure" from "the
part that's pure logic," and test the second part thoroughly even when
the first part can't be tested here — shows up throughout Phase 4's
handlers, not just this one.

## Worker liveness (Phase 10.1)

Section 38 asks `GET /health` to report on the worker specifically, not
just the API and its own direct dependencies (Postgres, Redis) — but the
worker is a separate process the API has no direct handle on (no shared
memory, no RPC channel between them). `apps/worker/src/utils/heartbeat.ts`
and `apps/api/src/services/workerHealth.ts` bridge that gap the same way
the rest of this project bridges API↔worker communication: through
Redis, not a new mechanism invented just for this.

**The mechanism.** The worker writes the current time to a single,
well-known Redis key (`WORKER_HEARTBEAT_KEY`, defined once in
`packages/shared` — the same reasoning as `JOB_QUEUE_NAME` and
`JOB_EVENTS_CHANNEL`, so the writer and reader can never drift onto two
different key names) on a configurable interval
(`WORKER_HEARTBEAT_INTERVAL_MS`, default 10s), with a TTL a few ticks
longer than that interval (`WORKER_HEARTBEAT_TIMEOUT_MS`, default 30s —
validated at startup to be greater than the interval, so a misconfigured
pair can't make every heartbeat stale on arrival). As long as the writes
keep landing, the key stays alive; the moment they stop — a crash, an
unhandled rejection, the container getting killed — Redis's own TTL
removes the key on its own. `GET /health` just checks whether the key
currently exists.

**Why this satisfies "do not report the worker as healthy when its
heartbeat is stale" without any time-math on the reading side.** The
naive version of this feature compares "now" against a stored last-seen
timestamp and a timeout threshold, computed wherever the check happens.
That means duplicating the threshold in two places (or importing it
across a process boundary) and trusting that the API's and worker's
clocks agree closely enough. Using Redis's own `EXPIRE` instead means
staleness *is* non-existence — there's no separate check to get wrong,
and no clock-skew risk, since the TTL countdown is tracked by Redis's own
server clock from the moment the `SET ... EX` command was received, not
by comparing two different processes' idea of "now."

**Why a single key, not one per worker instance.** The question
`GET /health` needs answered is "is there a worker alive right now",
not "which specific worker process is this" — see the full reasoning in
`packages/shared/src/health/worker-heartbeat.ts`'s own comment. If more
than one worker container is ever run at once (docs/architecture.md's
scalability diagram), each one just refreshes the same key on its own
schedule; Redis's normal last-write-wins semantics mean the key stays
fresh as long as *any* instance is still ticking, which is exactly the
question being asked, with no per-worker bookkeeping needed.

**Distinguishing "worker is dead" from "can't tell" — see
`deriveWorkerStatus` in `apps/api/src/services/workerHealth.ts`.** If
Redis itself is unreachable, a missing heartbeat key doesn't mean the
worker crashed — it means the API lost the one channel that could tell
it either way. That case reports `worker: "unknown"`, not
`worker: "unhealthy"`: folding it into "unhealthy" would claim to have
positively observed the worker as down, when what actually happened is
TaskFlow's own monitoring signal broke. This is what section 10.1's
"keep API, Redis and worker health states distinguishable" means in
practice — a Redis outage should read as a Redis problem, not get
misattributed to the worker.

**Graceful shutdown clears the key immediately.** `apps/worker/src/index.ts`'s
shutdown handler calls `clearHeartbeat()` before closing its Redis
connections, so a deliberately-stopped worker (a deploy, a scale-down)
is reported unhealthy right away instead of appearing falsely alive for
up to `WORKER_HEARTBEAT_TIMEOUT_MS` afterward. A crash skips this by
definition — there's no shutdown handler left to run — which is exactly
why the TTL exists as the fallback for that case rather than being the
only mechanism.
