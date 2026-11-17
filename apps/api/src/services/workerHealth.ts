import { WORKER_HEARTBEAT_KEY } from '@taskflow/shared';
import { redisConnection } from '../config/redis';

export interface WorkerHealth {
  /** True only when a worker's heartbeat key currently exists in Redis
   * — which, by construction, means it hasn't gone stale (see the
   * comment below). */
  healthy: boolean;
  /** The ISO-8601 timestamp the worker last wrote, or null if no
   * (unexpired) heartbeat exists — useful for a monitoring dashboard
   * even beyond the plain healthy/unhealthy signal. */
  lastHeartbeatAt: string | null;
}

export type WorkerStatus = 'healthy' | 'unhealthy' | 'unknown';

/**
 * Turns a heartbeat check into the string GET /health actually reports,
 * handling the one case `checkWorkerHealth` can't distinguish on its
 * own: if Redis itself is unreachable, a missing heartbeat key doesn't
 * mean the worker is dead — it means the API has no way to ask. Section
 * 10.1's "keep API, Redis and worker health states distinguishable"
 * means that case has to read as its own thing, not get silently folded
 * into "worker: unhealthy", which would wrongly claim to have positively
 * observed the worker as down rather than just having lost the only
 * channel that could tell.
 */
export function deriveWorkerStatus(redisHealthy: boolean, worker: Pick<WorkerHealth, 'healthy'>): WorkerStatus {
  if (!redisHealthy) return 'unknown';
  return worker.healthy ? 'healthy' : 'unhealthy';
}

/**
 * Reads `apps/worker/src/utils/heartbeat.ts`'s heartbeat key. Staleness
 * (section 10.1: "do not report the worker as healthy when its
 * heartbeat is stale") is enforced by Redis itself, not by comparing
 * timestamps here: the worker writes the key with a TTL, so a heartbeat
 * that stopped arriving simply stops existing once that TTL elapses —
 * `GET` returning `null` and `GET` returning "the key expired 40 seconds
 * ago" are the same outcome, by design, and this function doesn't need
 * to do its own time-math (or worry about clock skew between the API and
 * worker processes) to tell them apart.
 */
export async function checkWorkerHealth(): Promise<WorkerHealth> {
  const lastHeartbeatAt = await redisConnection.get(WORKER_HEARTBEAT_KEY);
  return {
    healthy: lastHeartbeatAt !== null,
    lastHeartbeatAt,
  };
}
