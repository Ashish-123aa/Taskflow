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
