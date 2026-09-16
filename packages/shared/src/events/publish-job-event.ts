import type { Redis } from 'ioredis';
import { JOB_EVENTS_CHANNEL, type JobEventPayload } from './job-events';

/**
 * A factory, not a ready-made publisher — see docs/realtime.md ("Why
 * every process gets its own dedicated pub/sub connection") for why the
 * caller must supply its own Redis connection rather than this module
 * owning one. Both apps/api and apps/worker construct their own instance
 * from their own dedicated connection (never the same connection BullMQ's
 * Worker uses for blocking operations).
 */
export function createJobEventPublisher(connection: Redis) {
  return async function publishJobEvent(payload: Omit<JobEventPayload, 'timestamp'>): Promise<void> {
    const event: JobEventPayload = { ...payload, timestamp: new Date().toISOString() };
    await connection.publish(JOB_EVENTS_CHANNEL, JSON.stringify(event));
  };
}
