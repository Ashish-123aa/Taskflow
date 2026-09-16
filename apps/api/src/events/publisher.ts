import { createJobEventPublisher, type JobEventPayload } from '@taskflow/shared';
import { redisConnection } from '../config/redis';
import { logger } from '../config/logger';

const rawPublish = createJobEventPublisher(redisConnection);

/**
 * A thin wrapper that never lets a Redis publish failure propagate to the
 * caller. By the time this is called, the job's status is already
 * durably correct in Postgres — a missed real-time update is a UX
 * degradation (the browser just doesn't update until the next fetch),
 * not a correctness problem, so it's logged and swallowed here rather
 * than failing the request that triggered it.
 */
export async function publishJobEvent(payload: Omit<JobEventPayload, 'timestamp'>): Promise<void> {
  try {
    await rawPublish(payload);
  } catch (err) {
    logger.warn('Failed to publish job event', { jobId: payload.jobId, type: payload.type, error: err });
  }
}
