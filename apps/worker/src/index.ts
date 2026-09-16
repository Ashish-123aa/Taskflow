import { prisma } from '@taskflow/shared';
import { env } from './config/env';
import { logger } from './config/logger';
import { redisConnection, redisPublisher } from './config/redis';
import { registerAllHandlers } from './jobs';
import { createJobWorker } from './workers/job.worker';

registerAllHandlers();

const worker = createJobWorker();

worker.on('completed', (job) => {
  logger.info('BullMQ reports job completed', { bullJobId: job.id });
});

worker.on('failed', (job, err) => {
  logger.warn('BullMQ reports job failed', { bullJobId: job?.id, error: err.message });
});

logger.info('TaskFlow Worker started', {
  concurrency: env.WORKER_CONCURRENCY,
  env: env.NODE_ENV,
});

/**
 * Graceful shutdown (section 37): stop accepting new jobs and let
 * in-flight jobs finish — `worker.close()` waits for active jobs to
 * complete before resolving — then close both Redis connections (the
 * Worker's own and the dedicated event-publishing one) and Postgres.
 */
async function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down worker gracefully`);
  await worker.close();
  await redisPublisher.quit();
  await redisConnection.quit();
  await prisma.$disconnect();
  logger.info('Worker shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
