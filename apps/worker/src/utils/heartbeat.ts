import { WORKER_HEARTBEAT_KEY } from '@taskflow/shared';
import { redisConnection } from '../config/redis';
import { env } from '../config/env';
import { logger } from '../config/logger';

/**
 * Liveness for the worker process (section 38: `GET /health`'s `worker`
 * field). The mechanism is deliberately the simplest thing that answers
 * the actual question ("is a worker alive right now") correctly: write
 * the current time to a well-known Redis key on an interval, with a TTL
 * a few ticks longer than that interval. As long as the writes keep
 * happening, Redis keeps the key alive; the moment they stop — a crash,
 * an unhandled rejection that takes the process down, the container
 * getting killed — Redis's own TTL removes the key on its own, with no
 * separate expiry-checking logic needed anywhere. `SET` is a fast,
 * non-blocking command (the same category as `PUBLISH`), so this reuses
 * the worker's existing shared `redisConnection` rather than opening a
 * dedicated one — see docs/realtime.md's dividing line for when a
 * connection actually needs to be dedicated.
 */
export function startHeartbeat(
  intervalMs: number = env.WORKER_HEARTBEAT_INTERVAL_MS,
  timeoutMs: number = env.WORKER_HEARTBEAT_TIMEOUT_MS,
): NodeJS.Timeout {
  const timeoutSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));

  async function beat(): Promise<void> {
    try {
      await redisConnection.set(WORKER_HEARTBEAT_KEY, new Date().toISOString(), 'EX', timeoutSeconds);
    } catch (err) {
      // A missed heartbeat write is exactly the failure mode this
      // mechanism is designed to survive: the key's TTL will simply
      // lapse if this keeps failing, and GET /health will correctly
      // start reporting the worker as unhealthy — no special handling
      // needed here beyond not letting a transient Redis error crash
      // the process over a health signal.
      logger.warn('Failed to write worker heartbeat', { error: err });
    }
  }

  // Write one immediately rather than waiting a full interval before the
  // first sign of life — otherwise a health check hitting GET /health in
  // the first few seconds after the worker starts would see a false
  // "unhealthy" even though the process is up and about to be fine.
  void beat();

  return setInterval(() => void beat(), intervalMs);
}

export function stopHeartbeat(timer: NodeJS.Timeout): void {
  clearInterval(timer);
}

/**
 * Deletes the heartbeat key outright. Called on graceful shutdown
 * (index.ts) so a deliberately-stopped worker is reported unhealthy
 * immediately, rather than appearing falsely alive for up to
 * WORKER_HEARTBEAT_TIMEOUT_MS after it's actually gone. A crash skips
 * this by definition — there's no shutdown handler to run — which is
 * exactly why the TTL exists as the fallback for that case.
 */
export async function clearHeartbeat(): Promise<void> {
  try {
    await redisConnection.del(WORKER_HEARTBEAT_KEY);
  } catch (err) {
    logger.warn('Failed to clear worker heartbeat on shutdown', { error: err });
  }
}
