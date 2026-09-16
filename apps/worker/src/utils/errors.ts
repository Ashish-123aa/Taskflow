/**
 * Thrown by a job handler to mean "retrying this would fail the exact
 * same way — don't bother" (section 12: a malformed request or invalid
 * input shouldn't be retried automatically). The worker's processor
 * function (workers/job.worker.ts) catches this specifically and
 * translates it into BullMQ's own `UnrecoverableError`, which tells
 * BullMQ to stop immediately regardless of the job's configured
 * `attempts`. Handlers throw this plain, queue-agnostic error rather than
 * importing BullMQ themselves — see docs/worker-system.md.
 */
export class NonRetryableJobError extends Error {}
