import Redis from 'ioredis';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// services/dashboardCache.ts imports config/redis.ts and config/logger.ts,
// both of which import the @taskflow/shared barrel — and with it a live
// PrismaClient construction this file has no use for and this sandbox
// can't generate (see the identical comment in rateLimit.test.ts).
vi.mock('@taskflow/shared', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  createRedisConnection: () => ({}),
}));

import { createRedisCache, type Cache } from '../src/utils/cache';
import { createDashboardStatsCache } from '../src/services/dashboardCache';

const redis = new Redis('redis://127.0.0.1:6379', { maxRetriesPerRequest: null });
const realCache = createRedisCache(redis);

async function cleanupTestKeys() {
  const keys = await redis.keys('cache:dashboard-stats:*');
  if (keys.length > 0) await redis.del(...keys);
}

describe('createDashboardStatsCache — against real Redis', () => {
  const statsCache = createDashboardStatsCache(realCache, 1); // 1s TTL, for fast expiry tests

  beforeEach(cleanupTestKeys);
  afterAll(async () => {
    await cleanupTestKeys();
    await redis.quit();
  });

  it('returns null for a user with nothing cached yet', async () => {
    expect(await statsCache.get('user-without-cache')).toBeNull();
  });

  it('returns exactly what was set for that user', async () => {
    const stats = { totalJobs: 5, jobsByType: [{ type: 'EMAIL', count: 5 }] };
    await statsCache.set('user-a', stats);
    expect(await statsCache.get('user-a')).toEqual(stats);
  });

  it('keeps two different users completely independent — no cross-account leakage', async () => {
    await statsCache.set('user-a', { totalJobs: 1 });
    await statsCache.set('user-b', { totalJobs: 99 });

    expect(await statsCache.get('user-a')).toEqual({ totalJobs: 1 });
    expect(await statsCache.get('user-b')).toEqual({ totalJobs: 99 });
  });

  it('invalidate() removes a cached value immediately, ahead of its TTL', async () => {
    const longTtlCache = createDashboardStatsCache(realCache, 3600);
    await longTtlCache.set('user-c', { totalJobs: 42 });
    expect(await longTtlCache.get('user-c')).toEqual({ totalJobs: 42 });

    await longTtlCache.invalidate('user-c');
    expect(await longTtlCache.get('user-c')).toBeNull();
  });

  it('respects the configured TTL', async () => {
    await statsCache.set('user-d', { totalJobs: 7 });
    expect(await statsCache.get('user-d')).toEqual({ totalJobs: 7 });

    await new Promise((resolve) => setTimeout(resolve, 1300));

    expect(await statsCache.get('user-d')).toBeNull();
  });
});

describe('createDashboardStatsCache — graceful degradation when the cache itself fails', () => {
  const failingCache: Cache = {
    get: () => Promise.reject(new Error('ECONNREFUSED')),
    set: () => Promise.reject(new Error('ECONNREFUSED')),
    del: () => Promise.reject(new Error('ECONNREFUSED')),
  };
  const statsCache = createDashboardStatsCache(failingCache, 30);

  it('get() resolves to null instead of throwing (falls through to a live query)', async () => {
    await expect(statsCache.get('any-user')).resolves.toBeNull();
  });

  it('set() resolves instead of throwing (the computed stats are still returned to the caller)', async () => {
    await expect(statsCache.set('any-user', { totalJobs: 1 })).resolves.toBeUndefined();
  });

  it('invalidate() resolves instead of throwing', async () => {
    await expect(statsCache.invalidate('any-user')).resolves.toBeUndefined();
  });
});
