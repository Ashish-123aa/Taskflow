import { createJobEventPublisher, type JobEventPayload } from '@taskflow/shared';
import { redisPublisher } from '../config/redis';
import { logger } from '../config/logger';

const rawPublish = createJobEventPublisher(redisPublisher);

/**
 * Same reasoning as apps/api/src/events/publisher.ts: a failed publish
 * should never fail the job itself. By the time this is called, the
 * job's status is already durably correct in Postgres — a missed
 * real-time update just means a browser doesn't see it until it next
 * fetches, not a correctness problem.
 */
export async function publishJobEvent(payload: Omit<JobEventPayload, 'timestamp'>): Promise<void> {
  try {
    await rawPublish(payload);
  } catch (err) {
    logger.warn('Failed to publish job event', { jobId: payload.jobId, type: payload.type, error: err });
  }
}
