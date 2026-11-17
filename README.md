# TaskFlow

**Reliable background processing and automation for modern applications.**

TaskFlow is a distributed job processing and automation platform: authenticated
users create, run, monitor, schedule, and retry background jobs (CSV
processing, external API calls, email, report generation, and more) without
ever blocking the main API server.

> **Status: Phase 11 of N — repository scaffolding, database design, a
> working Express API with JWT auth + RBAC, a real BullMQ job pipeline
> with every job type from the spec implemented, admin job/user
> management with audit logging, real-time job updates + in-app
> notifications, scheduled (cron) jobs, and a real React dashboard
> covering every page from the spec — plus, as of Phases 9–11, SSRF
> protection, rate limiting, dashboard caching, worker-liveness health
> checks, an audit-log endpoint, Swagger/OpenAPI docs, and backend +
> frontend test suites.** This is being built incrementally
> and documented as it goes; see [Roadmap](#roadmap) below for what's
> next. Nothing in this repo yet claims to be the finished product.

## Why this exists (the problem)

Long-running work — parsing a 500k-row CSV, calling a slow third-party API,
generating a report — can't happen inside a normal HTTP request without
either timing out or tying up server capacity that other users need. TaskFlow
solves this the way production systems actually do: the API persists the
request and hands it to a queue immediately, a separate worker process does
the actual work, and the frontend gets live updates over a WebSocket as the
job progresses. See [`docs/architecture.md`](docs/architecture.md) for the
full reasoning behind every piece of this design.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React, Vite, TypeScript, Tailwind CSS, React Router, TanStack Query, React Hook Form, Zod, Recharts, Socket.IO client |
| API | Node.js, Express, TypeScript |
| Worker | Node.js, TypeScript, BullMQ |
| Database | PostgreSQL + Prisma ORM |
| Queue / Cache | Redis + BullMQ |
| Real-time | Socket.IO (WebSockets) |
| Auth | JWT + bcrypt |
| Infra | Docker, Docker Compose, GitHub Actions |

## Repository structure

```text
taskflow/
├── apps/
│   ├── web/      React + Vite dashboard
│   ├── api/      Express REST API (never runs job logic itself)
│   └── worker/   BullMQ worker process (runs job logic; no HTTP)
├── packages/
│   └── shared/   Prisma schema/client + shared types & Zod schemas
├── docker/       Dockerfiles for api/worker (web added once containerized)
├── docs/         architecture, database, security, queue-system,
│                 worker-system, file-handling, admin, realtime,
│                 scheduling, frontend
└── docker-compose.yml
```

Each app is a separate npm workspace with its own `package.json`. Shared
database access and types live in `packages/shared` so the API and the
worker never drift out of sync with each other — see
[`docs/database.md`](docs/database.md) for why.

## Local setup (what works today)

As of Phase 8, the whole thing works end to end with a real UI: Postgres +
Redis + MailHog, a real Express API (auth, job endpoints with file
upload/download, admin job/user management, notifications, and
cron-based schedules), a real BullMQ worker that executes **every job
type** from the spec, real-time job updates pushed over WebSocket, a
scheduler that turns cron expressions into real jobs on time, and a React
dashboard covering every page from the spec — connected to all of the
above, including live updates.

```bash
git clone <repository>
cd taskflow

# 1. Install dependencies across all workspaces
npm install

# 2. Configure environment variables
cp .env.example .env
# then edit .env — at minimum, set JWT_SECRET to a random 32+ character string
# (e.g. `openssl rand -base64 48`)

# 3. Start Postgres + Redis + MailHog
npm run docker:up

# 4. Generate the Prisma Client and apply the initial migration
npm run prisma:generate
npm run prisma:migrate

# 5. Seed the two dev accounts (see Development credentials below)
npm run prisma:seed

# 6. Run the API, worker, and frontend in separate terminals (all auto-reload)
npm run dev:api
npm run dev:worker
npm run dev:web
```

Open `http://localhost:5173` — register an account (or log in with the
seeded credentials below) and you're in the actual dashboard. The API is
also directly reachable at `http://localhost:4000` for the curl examples
below.

```bash
# Register (also logs you in — a session cookie is saved to cookies.txt)
curl -i -c cookies.txt -X POST http://localhost:4000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Ada Lovelace","email":"ada@example.com","password":"Password123"}'

# Create an API_REQUEST job against a free public API
curl -i -b cookies.txt -X POST http://localhost:4000/api/v1/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Fetch current weather",
    "type": "API_REQUEST",
    "priority": "HIGH",
    "payload": { "url": "https://api.open-meteo.com/v1/forecast?latitude=52.52&longitude=13.41&current_weather=true" }
  }'
# -> { "success": true, "data": { "id": "...", "status": "QUEUED", ... } }

# Poll it a moment later (the worker terminal will log it picking the job up)
curl -b cookies.txt http://localhost:4000/api/v1/jobs/<id-from-above>
# -> status: "COMPLETED", result: { statusCode: 200, response: {...}, durationMs, timestamp }

curl http://localhost:4000/health
```

A few of the other job types, now that they're real:

```bash
# Upload a CSV — the response comes back the moment it's queued, same as
# any other job; watch the worker terminal for it streaming/parsing.
curl -b cookies.txt -X POST http://localhost:4000/api/v1/jobs/upload/csv \
  -F "file=@/path/to/your.csv" -F "name=Import contacts"

# Send an email — visit http://localhost:8025 (MailHog's web UI) to see it land
curl -i -b cookies.txt -X POST http://localhost:4000/api/v1/jobs \
  -H "Content-Type: application/json" \
  -d '{"name":"Notify","type":"EMAIL","payload":{"to":"someone@example.com","subject":"Job done","body":"See attached report."}}'

# Generate a report of your own job history, then download the CSV it produces
curl -i -b cookies.txt -X POST http://localhost:4000/api/v1/jobs \
  -H "Content-Type: application/json" -d '{"name":"Weekly report","type":"REPORT_GENERATION","payload":{}}'
curl -b cookies.txt -OJ http://localhost:4000/api/v1/jobs/<id-from-above>/download
```

Admin capabilities, once an account has been promoted to `ADMIN` (there's
no self-service endpoint for this — see `npm run prisma:seed`'s admin
account, or promote one directly via `npm run prisma:studio`). Remember
to log in again after promoting a role — see `docs/admin.md`.

```bash
# Every job across every user, not just the admin's own
curl -b cookies.txt http://localhost:4000/api/v1/admin/jobs

# Inspect dead-lettered jobs specifically (section 13)
curl -b cookies.txt "http://localhost:4000/api/v1/admin/jobs?status=DEAD_LETTER"

# Retry someone else's dead-lettered job with a larger retry budget —
# same endpoint any user uses on their own jobs
curl -i -b cookies.txt -X POST http://localhost:4000/api/v1/jobs/<id>/retry \
  -H "Content-Type: application/json" -d '{"maxAttempts": 5}'

# List users, disable one
curl -b cookies.txt http://localhost:4000/api/v1/admin/users
curl -i -b cookies.txt -X PATCH http://localhost:4000/api/v1/admin/users/<id> \
  -H "Content-Type: application/json" -d '{"isActive": false}'
```

Real-time updates and notifications, once a job has run:

```bash
# See your notifications (created by the worker on job completion/
# failure/dead-lettering — see docs/realtime.md)
curl -b cookies.txt http://localhost:4000/api/v1/notifications
curl -i -b cookies.txt -X PATCH http://localhost:4000/api/v1/notifications/<id>/read

# Watch job events arrive live over WebSocket — this is the same channel
# the frontend will use once Phase 8 builds a UI around it. Requires a
# WebSocket client; here's a one-off using Node + socket.io-client
# (already a dependency of apps/web), reading the cookie from cookies.txt:
node -e "
const io = require('socket.io-client');
const fs = require('fs');
const cookie = fs.readFileSync('cookies.txt', 'utf-8')
  .split('\n').find(l => l.includes('taskflow_token'))
  ?.split(/\s+/).pop();
const socket = io('http://localhost:4000', { extraHeaders: { Cookie: 'taskflow_token=' + cookie } });
socket.onAny((event, payload) => console.log(event, payload));
"
# ...then in another terminal, create or retry a job and watch the events
# (job:queued, job:started, job:progress, job:completed/failed/dead_letter)
# print as the worker processes it.
```

Scheduled jobs — create a recurring job, then confirm it's picked up:

```bash
# Runs every day at 8am; try "* * * * *" (every minute) locally if you
# want to actually watch it trigger without waiting for 8am
curl -i -b cookies.txt -X POST http://localhost:4000/api/v1/schedules \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Daily weather report",
    "jobType": "API_REQUEST",
    "cronExpression": "0 8 * * *",
    "payload": { "url": "https://api.open-meteo.com/v1/forecast?latitude=52.52&longitude=13.41&current_weather=true" }
  }'

curl -b cookies.txt http://localhost:4000/api/v1/schedules

# Disable it (section 39's "Disable schedule" test case)
curl -i -b cookies.txt -X PATCH http://localhost:4000/api/v1/schedules/<id> \
  -H "Content-Type: application/json" -d '{"isActive": false}'
```

To stop the infrastructure containers: `npm run docker:down`.

To run the whole stack (API + worker included) in Docker instead of the
`npm run dev:*` commands: `npm run docker:up:full` (builds
`docker/api.Dockerfile` and `docker/worker.Dockerfile`).

## Environment variables

All variables are documented inline in [`.env.example`](.env.example),
grouped by concern (database, Redis, auth, worker, email, uploads, SSRF
protection, rate limiting, caching, worker heartbeat). Starting in Phase 2, these are validated at process startup —
a missing required variable fails immediately with a clear error rather
than causing a confusing runtime failure later.

## Database

Full entity design and the reasoning behind every modeling decision (why
`Job.type` is a string and not an enum, why UUIDs, why these specific
indexes, cascade vs. set-null on deletes) is in
[`docs/database.md`](docs/database.md). Schema source of truth:
[`packages/shared/prisma/schema.prisma`](packages/shared/prisma/schema.prisma).

## Security

Password hashing, JWT storage, the stateless-session trade-off, how RBAC
is enforced, SSRF protection for the external-API job handlers, rate
limiting, and dashboard caching are all explained in [`docs/security.md`](docs/security.md).

## Queue & worker

How BullMQ is configured (priority mapping, retries, backoff, what does
and doesn't go on the queue), how the worker executes a job around each
handler call (status transitions, the `FAILED`/`RETRYING`/`DEAD_LETTER`
distinction, error classification), and how every job type from the spec
is now implemented are covered in
[`docs/queue-system.md`](docs/queue-system.md) and
[`docs/worker-system.md`](docs/worker-system.md).

## File handling

Safe filenames (never the client-supplied one), why CSV and image uploads
are two separate endpoints, and how the API and worker share a Docker
volume for uploaded/generated files are covered in
[`docs/file-handling.md`](docs/file-handling.md).

## Admin capabilities

Why `/jobs` and `/admin/jobs` are separate endpoints (not one endpoint
branching on role), how dead-letter inspection works, why an admin can't
disable their own account, why a promoted role needs a fresh login to
take effect, and how audit logging works are covered in
[`docs/admin.md`](docs/admin.md).

## Real-time updates & notifications

Why job status changes (which happen in the worker) reach connected
browsers (which only the API process can talk to) via a Redis pub/sub
bridge, why each process needs its own dedicated Redis connection for
this, how WebSocket connections are authenticated with the same JWT
cookie as everything else, and why notifications don't get a separate
real-time channel of their own are covered in
[`docs/realtime.md`](docs/realtime.md).

## Scheduled jobs

Why the scheduler runs inside the API process (reusing `jobService`)
rather than the worker, why it polls once a minute instead of using a
timer per schedule, why a failed trigger still advances `nextRunAt`, and
why a schedule's job type can't be changed after creation are covered in
[`docs/scheduling.md`](docs/scheduling.md).

## Frontend

Why the frontend keeps its own copy of types/schemas instead of importing
`@taskflow/shared` directly, the design direction, how the WebSocket
connection updates the UI without any component subscribing to socket
events directly, and why the dashboard and admin pages are lazy-loaded
are covered in [`docs/frontend.md`](docs/frontend.md).

## API documentation

In development (`NODE_ENV` not `production`), the API serves interactive
Swagger UI at `http://localhost:4000/api-docs` and the raw OpenAPI 3.0
document at `http://localhost:4000/api-docs.json`. The spec is
hand-maintained in `apps/api/src/docs/` (see the comment at the top of
`openapi.schemas.ts` for why it isn't generated from the Zod schemas).

## Testing

```bash
npm run docker:up      # needs Postgres + Redis running
npm run prisma:migrate
npm run test:api       # apps/api's vitest + supertest suite
npm run test:worker    # apps/worker's vitest suite
npm run test:shared    # packages/shared's vitest suite
npm run test:web       # apps/web's vitest + Testing Library suite (jsdom)
```

Current coverage:
- **Auth** — registration (success, duplicate email, weak password), login
  (success, wrong password, nonexistent email), `/me` authorization
- **Jobs** — creation (including custom `maxAttempts`), ownership
  enforcement, listing/pagination, cancel, retry-state rules (including a
  retry's `maxAttempts` override), delete-state rules — all require
  Postgres + Redis
- **Admin** — route protection (401/403), cross-user job visibility at
  `/admin/jobs` vs. personal `/jobs`, dead-letter filtering, user listing
  never leaking `passwordHash`, disabling a user (and that they can't log
  in afterward), self-disable prevention, and that audit log entries are
  written for genuine cross-user overrides but not for a user acting on
  their own resources — all require Postgres + Redis
- **Notifications** — personal scoping, unread filtering/count, mark-as-
  read ownership enforcement — require Postgres + Redis
- **Schedules** — creation (cron/payload validation), ownership,
  disabling, `nextRunAt` recomputation on cron change, and the
  scheduler's actual trigger logic run directly (not waiting for
  node-cron's real timer) — verifying a due schedule produces a real
  `Job`, advances `nextRunAt`, and creates a notification, and that a
  disabled schedule is skipped even when technically due — require
  Postgres + Redis
- **Uploads** — CSV/image MIME validation, safe-filename behavior,
  download-not-ready handling — require Postgres + Redis
- **Every job handler** — `API_REQUEST` (success, non-2xx-as-success,
  malformed input, network failure), `CSV_PROCESSING` (streamed against a
  real temp file), `EMAIL` (via nodemailer's non-network `jsonTransport`),
  `IMAGE_PROCESSING` (real resize/reformat via `sharp` against a
  generated test image), `DATA_TRANSFORMATION` (fully pure, no I/O), and
  `REPORT_GENERATION`'s CSV formatting — 26 tests
- **Cron/real-time plumbing** — next-run-date computation and cron
  validity checking against the real `cron-parser` library, the job-event
  publisher factory (mocked Redis connection), and the WebSocket auth
  cookie-parsing helper — **10 tests total, zero infrastructure required**

- **Phases 9–11 unit suites** — the SSRF guard, rate limiter, cache,
  dashboard-cache degradation, worker heartbeat/health, audit-log query
  building, token/auth middleware, the centralized error handler, and the
  shared Zod schemas. Several of these (`rateLimitRedisCounter`, `cache`,
  `dashboardCache`, `workerHealth`, and the worker's `heartbeat`) verify
  real Redis semantics and need `docker compose up -d redis`; the rest
  need no infrastructure.
- **Frontend (`apps/web`)** — Vitest + Testing Library + jsdom: login,
  register, route guards, job creation (type-aware forms, upload),
  dashboard, job list, job details (state-dependent actions, timeline,
  attempts), the shared UI primitives, and the formatting helpers —
  104 tests, with the API module mocked. See `docs/frontend.md`.

More suites are added alongside each new feature, not written
speculatively ahead of the code they test.

## Roadmap

Built incrementally, one phase at a time, each verified before moving on:

- [x] **Phase 1** — Repository structure, technology setup, database design
- [x] **Phase 2** — Express server, environment validation, JWT auth, RBAC middleware
- [x] **Phase 3** — Job creation API, BullMQ queue integration, worker process, and one working handler (`API_REQUEST`) end-to-end
- [x] **Phase 4** — Remaining job handlers (CSV, email, report, image, data transform), file upload/download
- [x] **Phase 5** — Admin job/user management, dead-letter inspection, configurable retry policy, audit logging
- [x] **Phase 6** — WebSocket real-time job updates (via a Redis pub/sub bridge from the worker), in-app notifications
- [x] **Phase 7** — Scheduled jobs (cron): full CRUD, a real scheduler creating real jobs on time
- [x] **Phase 8** — React dashboard: every page from section 32, connected to the real API and WebSocket events, verified with a real production build
- [x] **Phase 9** — Rate limiting, caching (including the dashboard stats endpoint), SSRF protection, security hardening
- [x] **Phase 10** — Full health checks (worker liveness), observability, admin monitoring (including an audit-log endpoint)
- [x] **Phase 11** — Broader test coverage (including the frontend, which has none yet), Swagger/OpenAPI docs
- [ ] **Phase 12** — Web app Docker image, CI/CD, deployment docs

> Structured logging, `/health` (API + database + Redis), configurable
> retries with exponential backoff, `FAILED`/`RETRYING`/`DEAD_LETTER`
> classification, every job handler from the spec, admin job/user
> management with audit logging, real-time job updates + notifications,
> scheduled jobs, and a full React dashboard already exist as of Phase 8
> — later phases extend these (rate limiting the endpoints this UI calls,
> observability into the workers it depends on), they don't introduce
> the UI itself from scratch.

## Development credentials

Created by `npm run prisma:seed`. **Development only — never valid or used
in any production deployment:**

| Role | Email | Password |
|---|---|---|
| ADMIN | `admin@taskflow.dev` | `Admin123!` |
| USER | `user@taskflow.dev` | `User123!` |

Example job / schedule seed data is added once the seeded accounts are
regularly used to demo the UI in a portfolio setting — you can, however,
create real jobs and schedules today by logging into the dashboard at
`http://localhost:5173` or via `POST /api/v1/jobs` and
`POST /api/v1/schedules` directly, which is more representative than
static seed rows would be.
