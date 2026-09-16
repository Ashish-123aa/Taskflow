import { prisma } from '@taskflow/shared';
import { createApp } from './app';
import { env } from './config/env';
import { logger } from './config/logger';
import { redisConnection, redisSubscriber } from './config/redis';
import { initSocketServer } from './websocket/socket';
import { startScheduler } from './scheduler/scheduler';

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(`TaskFlow API listening on port ${env.PORT}`, { env: env.NODE_ENV });
});

// Socket.IO attaches to the same HTTP server the REST API already
// listens on — see websocket/socket.ts for the full setup, including the
// Redis pub/sub bridge to the worker.
const io = initSocketServer(server);

// The scheduler runs as a periodic task inside this same process — see
// docs/scheduling.md for why it lives here (reusing jobService's
// validation/enqueue logic) rather than in the worker.
const scheduler = startScheduler();

/**
 * Graceful shutdown (section 37): stop accepting new connections, let
 * in-flight requests finish, stop the scheduler and close WebSocket
 * connections and their Redis subscription, then close the database
 * connection pool before exiting. Without this, a deploy or container
 * restart can cut off in-flight requests/connections and leave
 * Postgres/Redis connections dangling until they time out on their own.
 */
async function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down gracefully`);

  scheduler.stop();
  io.close();

  server.close(() => {
    Promise.all([redisSubscriber.quit(), redisConnection.quit(), prisma.$disconnect()])
      .then(() => {
        logger.info('Shutdown complete');
        process.exit(0);
      })
      .catch((err: unknown) => {
        logger.error('Error during shutdown', { error: err });
        process.exit(1);
      });
  });

  // Force-exit if graceful shutdown hangs (e.g. a request that never resolves).
  setTimeout(() => {
    logger.error('Forced shutdown after 10s timeout');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
