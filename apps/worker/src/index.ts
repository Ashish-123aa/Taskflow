import { prisma } from '@taskflow/shared';
import { env } from './config/env';
import { logger } from './config/logger';
import { redisConnection, redisPublisher } from './config/redis';
import { registerAllHandlers } from './jobs';
import { createJobWorker } from './workers/job.worker';
import { clearHeartbeat, startHeartbeat, stopHeartbeat } from './utils/heartbeat';

registerAllHandlers();

const worker = createJobWorker();

// Phase 10.1: liveness for GET /health's `worker` field — see
// utils/heartbeat.ts for the mechanism and docs/architecture.md's
// health-check section for how the API interprets it.
const heartbeatTimer = startHeartbeat();

worker.on('completed', (job) => {
  logger.info('BullMQ reports job completed', { bullJobId: job.id });
});

worker.on('failed', (job, err) => {
  logger.warn('BullMQ reports job failed', { bullJobId: job?.id, error: err.message });
});

logger.info('TaskFlow Worker started', {
  concurrency: env.WORKER_CONCURRENCY,
  env: env.NODE_ENV,
  heartbeatIntervalMs: env.WORKER_HEARTBEAT_INTERVAL_MS,
  heartbeatTimeoutMs: env.WORKER_HEARTBEAT_TIMEOUT_MS,
});

/**
 * Graceful shutdown (section 37): stop accepting new jobs and let
 * in-flight jobs finish — `worker.close()` waits for active jobs to
 * complete before resolving — then close both Redis connections (the
 * Worker's own and the dedicated event-publishing one) and Postgres.
 * The heartbeat is stopped and its key explicitly cleared *before* those
 * connections close, so GET /health reports this worker as gone
 * immediately rather than appearing falsely alive until the heartbeat's
 * TTL would otherwise have lapsed on its own.
 */
async function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down worker gracefully`);
  stopHeartbeat(heartbeatTimer);
  await clearHeartbeat();
  await worker.close();
  await redisPublisher.quit();
  await redisConnection.quit();
  await prisma.$disconnect();
  logger.info('Worker shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
