import type { Cache } from '../utils/cache';
import { createRedisCache } from '../utils/cache';
import { redisConnection } from '../config/redis';
import { env } from '../config/env';
import { logger } from '../config/logger';

export interface DashboardStatsCache {
  get<T>(userId: string): Promise<T | null>;
  set<T>(userId: string, stats: T): Promise<void>;
  invalidate(userId: string): Promise<void>;
}

// Scoped by userId, not a shared/global key — dashboard stats are
// entirely user-specific (jobRepository.getStats always filters
// `where: { userId }`), so the cache has to preserve that boundary too,
// or one user's cached numbers could leak into another's response
// (section 9.3: "Do not cache sensitive user-specific data incorrectly").
const keyFor = (userId: string): string => `cache:dashboard-stats:${userId}`;

/**
 * Wraps a generic `Cache` with the two policy decisions specific to
 * dashboard stats: the TTL (section 26: "cache the result briefly") and
 * graceful degradation on a Redis failure (section 9.3: get/set/invalidate
 * errors are logged and swallowed here, never thrown, so a Redis outage
 * degrades this endpoint to "always compute it live" instead of "500").
 *
 * Kept as its own factory taking a `Cache` — rather than reaching for the
 * real `redisConnection` directly — so this policy can be tested against
 * a fake `Cache` that deliberately throws on every call, without needing
 * to simulate an actual Redis outage. See tests/dashboardCache.test.ts.
 */
export function createDashboardStatsCache(cache: Cache, ttlSeconds: number): DashboardStatsCache {
  return {
    async get<T>(userId: string): Promise<T | null> {
      try {
        return await cache.get<T>(keyFor(userId));
      } catch (err) {
        logger.warn('Dashboard stats cache read failed; falling back to a live query', {
          userId,
          error: err,
        });
        return null;
      }
    },

    async set<T>(userId: string, stats: T): Promise<void> {
      try {
        await cache.set(keyFor(userId), stats, ttlSeconds);
      } catch (err) {
        logger.warn('Dashboard stats cache write failed; the freshly computed stats are still returned', {
          userId,
          error: err,
        });
      }
    },

    async invalidate(userId: string): Promise<void> {
      try {
        await cache.del(keyFor(userId));
      } catch (err) {
        logger.warn('Dashboard stats cache invalidation failed', { userId, error: err });
      }
    },
  };
}

/**
 * The one instance the rest of the app actually uses — wired from the
 * shared Redis connection and the configured TTL. Imported by
 * dashboard.service.ts (read/write on every stats request),
 * job.service.ts (invalidated on delete, the one job mutation that
 * doesn't publish a job event), and websocket/socket.ts (invalidated on
 * every other job-status transition, since that's the one place in the
 * API process that hears about all of them — see the comment there for
 * why).
 */
export const dashboardStatsCache = createDashboardStatsCache(
  createRedisCache(redisConnection),
  env.DASHBOARD_STATS_CACHE_TTL_SECONDS,
);
