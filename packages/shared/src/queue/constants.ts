/**
 * A single queue holds every job type. Job-type-specific routing happens
 * via the handler registry on the worker side (docs/worker-system.md), not
 * via separate BullMQ queues per type — one queue keeps priority ordering
 * meaningful across all job types at once (a CRITICAL email shouldn't wait
 * behind a LOW-priority CSV job just because they're in different queues
 * with no shared ordering).
 */
export const JOB_QUEUE_NAME = 'jobs';
