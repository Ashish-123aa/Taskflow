import type { Redis } from 'ioredis';

/**
 * A minimal, JSON-serializing cache abstraction over Redis. Kept
 * separate from any particular cached resource (dashboard stats today —
 * section 26: "Add Redis caching where useful", not just to this one
 * endpoint) so a new cached read only ever needs a key, a TTL, and a
 * value to serialize, not its own bespoke Redis wiring.
 *
 * Deliberately thin: this does NOT catch Redis errors itself, the same
 * way rateLimit.ts's `RateLimitCounter` doesn't. "If Redis is
 * unavailable, degrade gracefully rather than fail the request" is a
 * policy decision that belongs at the call site (services/dashboardCache.ts),
 * where what "gracefully" actually means (fall back to a live query, in
 * that case) is known. A cache implementation that silently swallowed
 * its own errors would hide that decision from every caller and make it
 * easy to forget to think about it — see rateLimit.ts's own comment on
 * the identical trade-off for the rate-limit counter.
 */
export interface Cache {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
}

export function createRedisCache(redis: Redis): Cache {
  return {
    async get<T>(key: string): Promise<T | null> {
      const raw = await redis.get(key);
      return raw === null ? null : (JSON.parse(raw) as T);
    },

    async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
      await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    },

    async del(key: string): Promise<void> {
      await redis.del(key);
    },
  };
}
