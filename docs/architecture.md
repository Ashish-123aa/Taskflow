# Architecture

> Other docs in this folder (`queue-system.md`, `worker-system.md`, `security.md`,
> `deployment.md`, `scalability.md`) are added phase-by-phase, as each system
> is actually built. This file covers the overall shape of TaskFlow and the
> reasoning behind the foundational choices made in Phase 1.

## The problem this architecture solves

An API server that does everything synchronously has a hard ceiling: every
request holds a connection open for as long as the work takes. A 500,000-row
CSV import, a slow third-party API call, or a batch report generation job
would each block a request thread for seconds or minutes. Do that under any
real concurrent load and the server runs out of connections and falls over,
even though the CPU is mostly idle waiting on I/O.

TaskFlow's answer is to never do slow work inside a request handler. Instead:

```text
Client
  │  POST /api/v1/jobs
  ▼
API Server  ──writes──▶  PostgreSQL   (job record: PENDING)
  │
  │  enqueue
  ▼
Redis / BullMQ Queue
  │
  ▼
Worker (separate process)  ──updates──▶  PostgreSQL   (RUNNING → COMPLETED)
  │
  ▼
WebSocket event  ──▶  Frontend (live update, no polling)
```

The API's only job is: validate the request, persist a row, hand the work
to the queue, and respond immediately with a job ID. The worker's only job
is: pull work off the queue and execute it. Neither one blocks the other.

## Why these specific technologies

**Why PostgreSQL instead of MongoDB?**
Jobs, users, schedules, and attempts are highly relational — a Job belongs
to a User and has many JobAttempts; a Schedule belongs to a User and spawns
Jobs. Dashboard queries need aggregates (`COUNT(*) WHERE status = ...`,
`GROUP BY type`) and multi-column filters (status + type + date range),
which is exactly what a relational database with proper indexes is built
for. Nothing in this domain benefits from a schemaless document model —
every job type shares the same envelope (status, priority, attempts,
timestamps); only `payload`/`result` vary, and Postgres's `jsonb` column
type already handles that variability without giving up joins, foreign
keys, or transactional integrity.

**Why Redis?**
The API must not execute job logic itself, so there needs to be fast,
shared infrastructure between the API process and the worker process(es)
to hand work off. Redis is in-memory and built for exactly this kind of
high-throughput, low-latency message passing — it also happens to be a
good fit for two other needs the spec calls for: rate limiting (atomic
increment-with-expiry) and short-lived caching, so one piece of
infrastructure does three jobs instead of three.

**Why BullMQ specifically, and not a hand-rolled Redis queue?**
Priority ordering, exponential backoff, retry limits, delayed/scheduled
jobs, and dead-letter handling are all things a naive `LPUSH`/`BRPOP`
queue does not give you for free — and getting retry/backoff semantics
correct under concurrent workers is easy to get subtly wrong. BullMQ
implements all of this on top of Redis already, tested and battle-hardened,
so effort goes into TaskFlow's job handlers instead of re-implementing
queue internals. (Full BullMQ configuration is covered in
`docs/queue-system.md`, added when the queue is implemented.)

**Why a separate worker process instead of background jobs inside the API?**
Two independent reasons: (1) an in-process background job still competes
with the Express event loop for CPU and can still delay request handling
under load, and (2) a worker crash or OOM from a bad job shouldn't take the
API down with it. Running them as separate processes (separate Docker
containers in production) means the API keeps serving requests even if
every worker is currently busy or has crashed, and workers can be scaled
independently of API instances — heavier on CPU-bound job types, lighter
on the API tier.

**Why WebSockets instead of polling?**
The spec requires the dashboard to update the instant a job's status
changes. Polling `GET /jobs/:id` every few seconds either feels laggy (long
interval) or wastes requests and DB queries when nothing has changed
(short interval). A WebSocket connection lets the worker push a `job:*`
event through the API server the moment the database is updated, so the
UI is exactly as current as the database, with no wasted requests. Users
who reconnect after a dropped connection just re-fetch current state once —
the job itself was never blocked by their disconnect, since it runs
server-side regardless of who's watching.

**Why Docker / Docker Compose?**
TaskFlow is five independently-deployable pieces (web, api, worker,
postgres, redis) that all need to run together locally and talk to each
other over a consistent network, with the same versions everyone else on
the team is using. Docker Compose describes that whole topology in one
file and brings it up with one command, instead of every developer
manually installing and configuring Postgres and Redis themselves.

## Current status (through Phase 8)

What exists right now:
- Monorepo structure (`apps/api`, `apps/worker`, `apps/web`, `packages/shared`)
- Full Postgres schema for the domain (`packages/shared/prisma/schema.prisma`)
- `docker-compose.yml` bringing up Postgres + Redis + MailHog + live `api`
  and `worker` services, sharing a volume for uploaded/generated files
- A real Express API: env validation, structured logging, centralized
  error handling, JWT auth (register/login/logout/me), RBAC middleware, a
  `/health` check covering the database and Redis, and an integration
  test suite — see [`docs/security.md`](security.md)
- A real BullMQ-backed job pipeline with **every job type from the spec
  implemented**: `API_REQUEST`/`SCHEDULED_API_FETCH`, `CSV_PROCESSING`,
  `EMAIL`, `IMAGE_PROCESSING`, `REPORT_GENERATION`, `DATA_TRANSFORMATION`
  — see [`docs/queue-system.md`](queue-system.md),
  [`docs/worker-system.md`](worker-system.md), and
  [`docs/file-handling.md`](file-handling.md)
- File upload (CSV/images) with safe randomized filenames, and a
  download endpoint for generated reports/processed images
- Configurable per-job retry policy (`maxAttempts` at creation and on
  manual retry), correct lifetime attempt tracking across manual retries,
  and admin job/user management with audit logging — see
  [`docs/admin.md`](admin.md)
- Real-time job updates over WebSocket (bridged from the worker via Redis
  pub/sub, since only the API process runs Socket.IO) and in-app
  notifications on job completion/failure/dead-lettering — see
  [`docs/realtime.md`](realtime.md)
- Scheduled (cron) jobs: full CRUD, a scheduler that polls for due
  schedules and creates real `Job` rows through the same path a manual
  `POST /jobs` uses — see [`docs/scheduling.md`](scheduling.md)
- A real React dashboard (`apps/web`) covering every page from section 32:
  login/register, dashboard with stats and charts, job list/create/details
  with a live execution timeline, schedules, notifications, profile, and
  admin job/user management — all connected to the WebSocket events above
  — see [`docs/frontend.md`](frontend.md)
- `GET /api/v1/dashboard/stats`, added specifically to support the
  dashboard UI (no Redis caching layer on it yet — that's still Phase 9)
- `docker/api.Dockerfile` and `docker/worker.Dockerfile`, both real

What's deliberately *not* built yet:
- A `docker/web.Dockerfile` / containerized frontend (Phase 12)
- Rate limiting, caching (including on the dashboard stats endpoint),
  SSRF protection (see the Phase 3 note in `docs/security.md` — the
  `API_REQUEST`/`SCHEDULED_API_FETCH` handlers don't have this yet)
- Full `/health` coverage for worker liveness, and an endpoint to read
  the audit log that's now being written (both deferred to Phase 10)
- A cleanup lifecycle for uploaded/generated files (see
  `docs/file-handling.md`)
- Frontend test coverage (see `docs/frontend.md`) and a profile-editing
  endpoint (the Profile page is currently read-only)

Each of those becomes its own phase, building on this foundation, with its
own explanation doc added here as it lands.
