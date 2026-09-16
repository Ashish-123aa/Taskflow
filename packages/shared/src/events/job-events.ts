import type { JobStatusValue } from '../constants/job-types';

/**
 * The channel job status changes are published to. The worker (where a
 * job's status actually changes) publishes here; the API (the only
 * process running a Socket.IO server) subscribes and re-emits to the
 * right connected browser clients. See docs/realtime.md for why this
 * indirection exists instead of the worker talking to Socket.IO directly.
 */
export const JOB_EVENTS_CHANNEL = 'taskflow:job-events';

/**
 * Matches the event names from section 23 exactly, plus `job:dead_letter`
 * — not in that list, but needed separately from `job:failed` since
 * section 24 requires a distinct notification for "job moved to
 * dead-letter state" vs. a plain failure.
 */
export const JOB_EVENT_TYPES = [
  'job:queued',
  'job:started',
  'job:progress',
  'job:completed',
  'job:failed',
  'job:retrying',
  'job:cancelled',
  'job:dead_letter',
] as const;
export type JobEventType = (typeof JOB_EVENT_TYPES)[number];

export interface JobEventPayload {
  jobId: string;
  userId: string;
  type: JobEventType;
  status: JobStatusValue;
  progress?: number;
  error?: string;
  timestamp: string;
}
