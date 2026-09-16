# Real-Time Updates & Notifications

Added in Phase 6. Covers `apps/api/src/websocket/`, both apps'
`events/publisher.ts`, and the notification endpoints.

## The core problem: only the API runs Socket.IO, but the worker changes job status

A browser connects over WebSocket to the API process — that's the only
process serving HTTP, so it's the only one that can accept a WebSocket
upgrade. But a job's status only ever changes inside the **worker**
process (`apps/worker/src/workers/job.worker.ts` — see
`docs/worker-system.md`). The worker has no HTTP server, no WebSocket
server, and no open connections to any browser at all. Something has to
bridge "the worker just changed a job's status" to "tell the right
browser about it," across a process boundary.

## Why Redis pub/sub, not a direct connection

Redis is already running, already a dependency of both processes, and
already used for message passing between them (the BullMQ queue itself).
Redis's `PUBLISH`/`SUBSCRIBE` commands are a natural fit for the same
job: the worker publishes a small JSON event to a channel
(`packages/shared/src/events/job-events.ts`); the API subscribes to that
channel and re-emits each event to the right connected Socket.IO clients.
Neither process needs to know anything about the other's location or
existence beyond "we both talk to the same Redis" — the same
loose coupling BullMQ itself already relies on.

The alternative — the worker opening an HTTP connection to the API and
calling some internal "please emit this" endpoint — would work, but adds
an extra network hop, an extra auth concern (that endpoint would need to
be locked down so nothing else could call it), and a dependency on the
API being reachable from the worker's network, none of which Redis
pub/sub needs.

## Why every process gets its own dedicated pub/sub connection

`apps/api/src/config/redis.ts` and `apps/worker/src/config/redis.ts` each
export more than one Redis connection, and this is deliberate, not
oversight:

- **The worker's `redisConnection`** is held by BullMQ's `Worker` for
  blocking operations. **`redisPublisher`** is a second, separate
  connection used only for `PUBLISH`. Sharing the first connection for
  publishing risks a real-time event getting queued behind whatever
  blocking command BullMQ currently has in flight — a "real-time" update
  that arrives late because it was stuck behind an unrelated blocking
  call defeats the point.
- **The API's `redisSubscriber`** is fully dedicated, for a stricter
  reason: once a Redis connection issues `SUBSCRIBE`, Redis restricts
  that connection to pub/sub commands only until it unsubscribes. It
  *cannot* also be used for the BullMQ `Queue` or the `/health` check's
  `PING` — those would simply fail on a connection in subscriber mode.
  `redisConnection` on the API side stays free for the `Queue` and health
  check; `PUBLISH` (used when the API itself originates an event, like
  `job:queued`) is fine to share there, since `PUBLISH` isn't a blocking
  command the way BullMQ's own internal calls are.

## Per-user rooms: the same ownership boundary as the REST API

On connection, `apps/api/src/websocket/socket.ts` authenticates the
socket the same way an HTTP request is authenticated — by verifying the
JWT from the (same) `taskflow_token` cookie, read manually via the
`cookie` package since Socket.IO's handshake doesn't go through Express's
own `cookie-parser` middleware. Each authenticated socket joins a room
named `user:<their id>`. When the Redis subscriber receives a job event,
it emits into `user:<event.userId>`'s room specifically — never broadcast
to every connected client. This means the WebSocket layer enforces the
exact same "you only see your own jobs" boundary the REST API's
`assertOwnership` does; a browser can't receive another user's job
updates just by having an open connection.

## Why notifications don't get their own WebSocket channel

Section 24 asks for in-app notifications on job completion, failure, and
dead-lettering. Rather than build a second Redis channel and a second
Socket.IO event type purely for notifications, the existing
`job:completed` / `job:failed` / `job:dead_letter` events already tell a
connected client exactly the moments a notification would exist for. The
frontend (built in Phase 8) can treat "I received a `job:failed` event"
as the cue to re-fetch `GET /api/v1/notifications` (or just optimistically
show a toast using the event's own data) rather than maintaining a
parallel real-time feed for a resource whose creation is already
announced by an event that exists anyway. `GET /api/v1/notifications` and
`PATCH /api/v1/notifications/:id/read` (section 30) remain plain REST —
notifications are read/managed on demand, not streamed.

## Why notification creation has no admin override

Unlike jobs, `notificationService` has no `assertOwnership`-with-admin-
bypass equivalent — a notification belongs to exactly the person it was
created for, full stop, and there's no `ADMIN` capability in section 5
that mentions reading or managing another user's notifications. This is
intentionally asymmetric with how jobs work; not every resource in the
system needs the same admin-override shape.

## What still isn't real-time

Job creation from a **scheduled** run (Phase 7, now landed — see
`docs/scheduling.md`) flows through this exact same `publishJobEvent`
path with no extra wiring: the scheduler calls `jobService.createJob`
directly, the same function `POST /jobs` calls, so a scheduled trigger's
`job:queued` event looks identical to a manually created one. Worker
liveness/health information is *not* pushed over this channel; that's
part of the observability work in Phase 10, which is a different kind of
"real-time" concern (operational monitoring, not per-user job updates)
and doesn't belong on a channel scoped to individual users' job events.
