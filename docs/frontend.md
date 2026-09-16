# Frontend

Added in Phase 8. Covers `apps/web` — the first real UI in this project;
everything before this phase was a placeholder.

## Why the frontend doesn't import `@taskflow/shared`

Every backend app (`apps/api`, `apps/worker`) imports types, Zod schemas,
and constants from `@taskflow/shared`. The frontend deliberately does
**not** — `apps/web/src/lib/constants.ts`, `lib/types.ts`, and
`lib/schemas.ts` are hand-maintained copies of the same job types,
statuses, priorities, and validation rules.

The reason is that `@taskflow/shared`'s barrel file (`src/index.ts`)
eagerly exports everything, including `prisma.ts` (constructs a live
`PrismaClient`), `logger.ts` (imports `winston`), and
`queue/connection.ts` (imports `ioredis`) — all Node-only modules that
either don't run in a browser at all (native bindings, `net`/`fs`) or
would bloat the bundle pulling in server-side tooling that never executes
client-side. Importing anything from `@taskflow/shared` — even a single
Zod schema — pulls in that whole import graph, because ES module bundlers
resolve the package's entry point before they can tree-shake what's
actually used.

The correct long-term fix is splitting `packages/shared` into a
browser-safe package (types, Zod schemas, constants — no Node
dependencies) and a server-only package (Prisma, Redis, logging). That's
a real refactor touching every import site in `apps/api` and
`apps/worker`, which is out of scope for "build the frontend" — so this
phase takes the pragmatic path (a small, deliberately duplicated copy)
and documents the trade-off rather than either blocking on a bigger
refactor or silently risking a broken/bloated frontend build. Keeping
these two copies in sync by hand is a real, ongoing cost of this
decision — worth revisiting if `packages/shared`'s browser-unsafe surface
keeps growing.

## Design direction

TaskFlow's frontend is built for a technical, backend-engineer audience
monitoring a job queue — closer to Linear, Vercel's dashboard, or GitHub
Actions than a marketing SaaS page. That drove a few concrete choices:

- **Manrope for headings, Inter for body/UI text, a monospace face for
  anything literally technical** (job IDs, durations, cron expressions,
  JSON payloads). The monospace usage is functional here, not decorative
  — this app genuinely displays a lot of IDs and structured data.
- **A dedicated status-color system** (`tailwind.config.js`'s `status.*`
  palette), used identically for badges and chart segments — someone
  learns the color language once instead of each component picking
  colors independently.
- **Hairline borders over heavy shadows**, light theme, calm and
  information-dense rather than decorated — the goal is fast scanning of
  a table or a dashboard, not visual flourish.
- **One deliberate motion touch**: toasts and dialogs ease in on actual
  state changes (a mutation completing, a WebSocket event landing), not
  on hover or a timer.

## State management

Server state (jobs, schedules, notifications, dashboard stats) is
TanStack Query end to end — no Redux, no manually-managed loading/error
booleans scattered through components. Two small pieces of client-only
state get React Context instead: `AuthContext` (who's logged in — backed
by a query against `GET /auth/me`, since there's no token to read
synchronously; see `docs/security.md`'s cookie-based session design) and
`ToastContext` (ephemeral UI notifications, unrelated to the
`Notification` database model). `SocketContext` sits between the two:
it's a live connection, not really "state" in the traditional sense, but
its entire job is to react to server-side events by invalidating the
right React Query cache keys — see the next section.

## How the WebSocket connection actually updates the UI

No component subscribes to socket events directly. `SocketContext`
connects once, for the whole app, the moment a user is logged in, and
its event handlers do exactly one kind of thing: call
`queryClient.invalidateQueries()` for the query keys a given job event
affects (`['jobs']`, `['job', id]`, `['dashboard', 'stats']`,
`['notifications']`). React Query then refetches whatever's actually
mounted on screen. This means a component doesn't need to know anything
about WebSockets at all — `useQuery(['job', id])` on the job details page
just happens to refresh the instant something changes, because something
elsewhere in the tree told the cache it's stale. Terminal states
(`job:completed`, `job:failed`, `job:dead_letter`) additionally trigger a
toast, since those are the moments someone would want to know about even
if they don't have that job's page open.

The job details page also polls every two seconds while a job is
`RUNNING`, independent of the socket. Belt-and-suspenders: if a
WebSocket reconnect is in flight after a network blip, the page still
catches up within a couple of seconds instead of appearing frozen.

## Job creation is one page with type-aware sub-forms, not a generic JSON box

`JobCreatePage` could have been a single "paste your JSON payload" text
box for every job type — much less code, but a worse experience for
exactly the types people create most often. Instead: `API_REQUEST` and
`SCHEDULED_API_FETCH` get a URL + method field, `EMAIL` gets
recipient/subject/body fields, `CSV_PROCESSING` and `IMAGE_PROCESSING`
get an actual file picker wired to the dedicated upload endpoints (not a
JSON payload at all — see `docs/file-handling.md`), and only
`DATA_TRANSFORMATION` and `REPORT_GENERATION` — whose payloads are either
inherently structured or trivially empty — fall back to a raw JSON
textarea.

## Route-level code splitting

The dashboard page pulls in the entire Recharts library; the two admin
pages are, by construction, only ever loaded by a fraction of accounts.
`App.tsx` lazy-loads exactly these three routes via `React.lazy` +
`Suspense`. This wasn't a preemptive optimization — it's a direct
response to Vite's own build warning about a >500KB main chunk during
this phase's build verification. Splitting just these three brought the
main bundle from ~888KB to ~463KB, with Recharts isolated into its own
~417KB chunk that only downloads when someone actually visits
`/dashboard`.

## What isn't tested yet

Every backend phase in this project has a real test suite (see each
phase's own docs). The frontend doesn't yet — no component or
integration tests, no Playwright/Cypress e2e coverage. What *was*
verified here is a full production build (`tsc -b && vite build`)
against the actual dependency versions, which catches type errors,
import-resolution problems, and JSX/config issues a read-through alone
would likely miss (it caught several real bugs during this phase, mostly
around TypeScript not being able to narrow a `useQuery` result's `data`
field to defined inside a JSX ternary the way an explicit early-return
`if` block allows). Real frontend test coverage is reasonable scope for
Phase 11 ("broader test coverage"), alongside the backend gaps already
noted there.
