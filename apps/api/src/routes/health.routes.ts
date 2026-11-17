import { Router } from 'express';
import { prisma } from '@taskflow/shared';
import { redisConnection } from '../config/redis';
import { asyncHandler } from '../utils/asyncHandler';
import { checkWorkerHealth, deriveWorkerStatus } from '../services/workerHealth';

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
 * Checks the database, Redis, AND worker liveness (section 38) — the
 * worker check is a Phase 10.1 addition; see services/workerHealth.ts
 * for the heartbeat mechanism it reads. Each component is reported
 * separately and independently (section 10.1: "keep API, Redis and
 * worker health states distinguishable") — the fact that this endpoint
 * answered at all is itself the API's own liveness signal, so there's
 * no separate "api" field the way there is for the other three.
 */
router.get(
  '/health',
  asyncHandler(async (_req, res) => {
    const [databaseHealthy, redisHealthy, workerHealth] = await Promise.all([
      checkDatabase(),
      checkRedis(),
      checkWorkerHealth(),
    ]);

    const workerStatus = deriveWorkerStatus(redisHealthy, workerHealth);
    const healthy = databaseHealthy && redisHealthy && workerStatus === 'healthy';

    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'healthy' : 'unhealthy',
      database: databaseHealthy ? 'healthy' : 'unhealthy',
      redis: redisHealthy ? 'healthy' : 'unhealthy',
      worker: workerStatus,
      workerLastHeartbeatAt: workerHealth.lastHeartbeatAt,
    });
  }),
);

export default router;
