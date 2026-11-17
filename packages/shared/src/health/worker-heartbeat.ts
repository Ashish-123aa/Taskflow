/**
 * The Redis key the worker writes its liveness heartbeat to
 * (apps/worker/src/utils/heartbeat.ts) and the API reads to answer "is a
 * worker currently alive" for `GET /health` (section 38). Defined once
 * here — the same reasoning as `JOB_QUEUE_NAME` and `JOB_EVENTS_CHANNEL`
 * — so the two processes can never drift onto two different key names.
 *
 * Deliberately a single well-known key, not one per worker instance: the
 * question this answers is "is there at least one worker alive right
 * now capable of processing jobs", not "which specific worker process is
 * this". If more than one worker container is ever run at once (see
 * docs/architecture.md's scalability diagram), every instance just
 * refreshes the same key on its own interval — Redis's own
 * last-write-wins semantics mean the key stays fresh as long as *any*
 * instance is still alive and ticking, which is exactly the question
 * being asked. Tracking per-worker identity would answer a different,
 * more detailed question ("which one died") that nothing in this phase
 * actually needs yet.
 */
export const WORKER_HEARTBEAT_KEY = 'worker:heartbeat:last';
