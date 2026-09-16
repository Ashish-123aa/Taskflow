import { Queue } from 'bullmq';
import { JOB_QUEUE_NAME, type JobQueueData } from '@taskflow/shared';
import { redisConnection } from '../config/redis';

/**
 * The API's producer side: adds jobs to the queue, never processes them.
 * `removeOnComplete`/`removeOnFail` keep BullMQ's own Redis-side
 * bookkeeping small — Postgres (Job, JobAttempt) is already the durable,
 * queryable record of every job's history; BullMQ's copy only needs to
 * live long enough to actually run the work (see docs/queue-system.md).
 */
export const jobQueue = new Queue<JobQueueData>(JOB_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
    removeOnFail: { age: 7 * 24 * 60 * 60 },
  },
});
