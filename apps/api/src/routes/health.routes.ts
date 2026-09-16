import { Router } from 'express';
import { prisma } from '@taskflow/shared';
import { redisConnection } from '../config/redis';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

async function checkDatabase(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

async function checkRedis(): Promise<boolean> {
  try {
    const pong = await redisConnection.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}

/**
 * Now checks the database AND Redis, since the API depends on both as of
 * Phase 3 (job creation writes to Postgres and enqueues to Redis). Worker
 * liveness isn't included yet — that needs the worker to report its own
 * heartbeat somewhere the API can read, which is a Phase 10 concern
 * (section 38 groups "API, Database, Redis, Worker" together, but they
 * don't all become checkable at once).
 */
router.get(
  '/health',
  asyncHandler(async (_req, res) => {
    const [databaseHealthy, redisHealthy] = await Promise.all([checkDatabase(), checkRedis()]);
    const healthy = databaseHealthy && redisHealthy;

    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'healthy' : 'unhealthy',
      database: databaseHealthy ? 'healthy' : 'unhealthy',
      redis: redisHealthy ? 'healthy' : 'unhealthy',
    });
  }),
);

export default router;
