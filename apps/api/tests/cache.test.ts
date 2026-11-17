import Redis from 'ioredis';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createRedisCache } from '../src/utils/cache';

const redis = new Redis('redis://127.0.0.1:6379', { maxRetriesPerRequest: null });
const cache = createRedisCache(redis);

const TEST_KEY_PREFIX = 'cache:test:';

async function cleanupTestKeys() {
  const keys = await redis.keys(`${TEST_KEY_PREFIX}*`);
  if (keys.length > 0) await redis.del(...keys);
}

describe('createRedisCache', () => {
  beforeEach(cleanupTestKeys);
  afterAll(async () => {
    await cleanupTestKeys();
    await redis.quit();
  });

  it('returns null for a key that was never set', async () => {
    const value = await cache.get(`${TEST_KEY_PREFIX}never-set`);
    expect(value).toBeNull();
  });

  it('round-trips a simple value through JSON', async () => {
    const key = `${TEST_KEY_PREFIX}simple`;
    await cache.set(key, 'hello', 60);
    expect(await cache.get<string>(key)).toBe('hello');
  });

  it('round-trips a nested object with arrays, exactly as stored', async () => {
    const key = `${TEST_KEY_PREFIX}nested`;
    const value = {
      totalJobs: 12,
      jobsByType: [
        { type: 'API_REQUEST', count: 5 },
        { type: 'EMAIL', count: 7 },
      ],
      jobsOverTime: [{ date: '2026-01-01', total: 3, completed: 2, failed: 1 }],
    };

    await cache.set(key, value, 60);
    const result = await cache.get<typeof value>(key);

    expect(result).toEqual(value);
  });

  it('overwrites a previously cached value', async () => {
    const key = `${TEST_KEY_PREFIX}overwrite`;
    await cache.set(key, { version: 1 }, 60);
    await cache.set(key, { version: 2 }, 60);

    expect(await cache.get<{ version: number }>(key)).toEqual({ version: 2 });
  });

  it('expires a value after its TTL elapses', async () => {
    const key = `${TEST_KEY_PREFIX}expiry`;
    await cache.set(key, 'short-lived', 1);

    expect(await cache.get<string>(key)).toBe('short-lived');

    await new Promise((resolve) => setTimeout(resolve, 1200));

    expect(await cache.get<string>(key)).toBeNull();
  });

  it('removes a value on del(), before its TTL would otherwise expire it', async () => {
    const key = `${TEST_KEY_PREFIX}del`;
    await cache.set(key, 'to-be-deleted', 60);
    expect(await cache.get<string>(key)).toBe('to-be-deleted');

    await cache.del(key);
    expect(await cache.get<string>(key)).toBeNull();
  });

  it('is a no-op to del() a key that was never set', async () => {
    await expect(cache.del(`${TEST_KEY_PREFIX}never-existed`)).resolves.not.toThrow();
  });

  it('keeps different keys completely independent', async () => {
    const keyA = `${TEST_KEY_PREFIX}independent-a`;
    const keyB = `${TEST_KEY_PREFIX}independent-b`;

    await cache.set(keyA, 'a-value', 60);
    await cache.set(keyB, 'b-value', 60);
    await cache.del(keyA);

    expect(await cache.get<string>(keyA)).toBeNull();
    expect(await cache.get<string>(keyB)).toBe('b-value');
  });
});
