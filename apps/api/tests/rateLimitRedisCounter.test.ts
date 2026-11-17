import Redis from 'ioredis';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// See the identical comment in rateLimit.test.ts: rateLimit.ts pulls in
// config/logger.ts, which imports the @taskflow/shared barrel and, with
// it, a live PrismaClient construction this file has no use for and
// this sandbox can't generate anyway.
vi.mock('@taskflow/shared', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { createRedisRateLimitCounter } from '../src/middleware/rateLimit';

// A real, local Redis connection (see the sandbox's own redis-server,
// started for exactly this purpose) — this file specifically exists to
// verify the Lua script's atomicity and TTL behavior against genuine
// Redis semantics, which a fake in-memory counter (used in
// rateLimit.test.ts for the middleware's own logic) can't meaningfully
// stand in for.
const redis = new Redis('redis://127.0.0.1:6379', { maxRetriesPerRequest: null });
const counter = createRedisRateLimitCounter(redis);

const TEST_KEY_PREFIX = 'ratelimit:test:';

async function cleanupTestKeys() {
  const keys = await redis.keys(`${TEST_KEY_PREFIX}*`);
  if (keys.length > 0) await redis.del(...keys);
}

describe('createRedisRateLimitCounter', () => {
  beforeEach(cleanupTestKeys);
  afterAll(async () => {
    await cleanupTestKeys();
    await redis.quit();
  });

  it('starts a fresh key at 1 and increments on each call', async () => {
    const key = `${TEST_KEY_PREFIX}basic`;

    expect(await counter.increment(key, 60)).toBe(1);
    expect(await counter.increment(key, 60)).toBe(2);
    expect(await counter.increment(key, 60)).toBe(3);
  });

  it('sets a TTL only on the very first increment, not on every subsequent one', async () => {
    const key = `${TEST_KEY_PREFIX}ttl-once`;

    await counter.increment(key, 100);
    const ttlAfterFirst = await redis.ttl(key);
    expect(ttlAfterFirst).toBeGreaterThan(0);
    expect(ttlAfterFirst).toBeLessThanOrEqual(100);

    // Force the TTL down, then increment again — if the script pushed
    // the expiry back on every call (the exact bug the Lua script
    // exists to avoid), this would jump back up near 100. It shouldn't.
    await redis.expire(key, 5);
    await counter.increment(key, 100);
    const ttlAfterSecond = await redis.ttl(key);

    expect(ttlAfterSecond).toBeGreaterThan(0);
    expect(ttlAfterSecond).toBeLessThanOrEqual(5);
  });

  it('reports the remaining TTL via ttl()', async () => {
    const key = `${TEST_KEY_PREFIX}ttl-report`;
    await counter.increment(key, 50);

    const ttl = await counter.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(50);
  });

  it('reports a non-positive TTL for a key that does not exist', async () => {
    const ttl = await counter.ttl(`${TEST_KEY_PREFIX}never-created`);
    expect(ttl).toBeLessThanOrEqual(0);
  });

  it('resets the count to 1 after the window actually expires', async () => {
    const key = `${TEST_KEY_PREFIX}expiry`;

    await counter.increment(key, 1); // 1-second window
    await counter.increment(key, 1);
    expect(await redis.get(key)).toBe('2');

    await new Promise((resolve) => setTimeout(resolve, 1200));

    expect(await counter.increment(key, 1)).toBe(1);
  });

  it('keeps two different keys completely independent', async () => {
    const keyA = `${TEST_KEY_PREFIX}independent-a`;
    const keyB = `${TEST_KEY_PREFIX}independent-b`;

    await counter.increment(keyA, 60);
    await counter.increment(keyA, 60);
    await counter.increment(keyA, 60);
    await counter.increment(keyB, 60);

    expect(await redis.get(keyA)).toBe('3');
    expect(await redis.get(keyB)).toBe('1');
  });

  it('stays correct under concurrent increments (the whole point of using a Lua script)', async () => {
    const key = `${TEST_KEY_PREFIX}concurrent`;

    const results = await Promise.all(
      Array.from({ length: 25 }, () => counter.increment(key, 60)),
    );

    // 25 concurrent increments against the same key must produce 25
    // distinct sequential values with no duplicates or gaps — the
    // failure mode a non-atomic "GET, add one, SET" implementation
    // would be prone to under real concurrency.
    const sorted = [...results].sort((a, b) => a - b);
    expect(sorted).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  });

  it('is safe to build more than once against the same connection', async () => {
    const secondCounter = createRedisRateLimitCounter(redis);
    const key = `${TEST_KEY_PREFIX}redefine`;

    expect(await secondCounter.increment(key, 60)).toBe(1);
    expect(await counter.increment(key, 60)).toBe(2);
  });
});
