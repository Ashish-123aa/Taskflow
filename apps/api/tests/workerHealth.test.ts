import Redis from 'ioredis';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

// services/workerHealth.ts pulls in config/redis.ts, which imports the
// @taskflow/shared barrel (createRedisConnection) — and with it a live
// PrismaClient construction this file has no use for and this sandbox
// can't generate (see the identical comment in rateLimit.test.ts). The
// mock re-implements createRedisConnection with the *real* ioredis
// constructor, since this test needs a genuine connection to verify
// against.
vi.mock('@taskflow/shared', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  createRedisConnection: (url: string) => new Redis(url, { maxRetriesPerRequest: null }),
  WORKER_HEARTBEAT_KEY: 'worker:heartbeat:last',
}));

import { WORKER_HEARTBEAT_KEY } from '@taskflow/shared';
import { checkWorkerHealth, deriveWorkerStatus } from '../src/services/workerHealth';

const redis = new Redis('redis://127.0.0.1:6379', { maxRetriesPerRequest: null });

describe('checkWorkerHealth', () => {
  afterEach(async () => {
    await redis.del(WORKER_HEARTBEAT_KEY);
  });

  afterAll(async () => {
    await redis.quit();
  });

  it('reports unhealthy with no lastHeartbeatAt when no heartbeat has ever been written', async () => {
    const result = await checkWorkerHealth();
    expect(result).toEqual({ healthy: false, lastHeartbeatAt: null });
  });

  it('reports healthy with the timestamp once a heartbeat exists', async () => {
    const timestamp = new Date().toISOString();
    await redis.set(WORKER_HEARTBEAT_KEY, timestamp, 'EX', 60);

    const result = await checkWorkerHealth();
    expect(result).toEqual({ healthy: true, lastHeartbeatAt: timestamp });
  });

  it('reports unhealthy again once the heartbeat key expires', async () => {
    await redis.set(WORKER_HEARTBEAT_KEY, new Date().toISOString(), 'EX', 1);
    expect((await checkWorkerHealth()).healthy).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 1200));

    expect(await checkWorkerHealth()).toEqual({ healthy: false, lastHeartbeatAt: null });
  });

  it('reports unhealthy immediately after the key is deleted, ahead of its TTL', async () => {
    await redis.set(WORKER_HEARTBEAT_KEY, new Date().toISOString(), 'EX', 3600);
    expect((await checkWorkerHealth()).healthy).toBe(true);

    await redis.del(WORKER_HEARTBEAT_KEY);
    expect((await checkWorkerHealth()).healthy).toBe(false);
  });
});

describe('deriveWorkerStatus', () => {
  it('is "healthy" when Redis is up and the heartbeat is present', () => {
    expect(deriveWorkerStatus(true, { healthy: true })).toBe('healthy');
  });

  it('is "unhealthy" when Redis is up but the heartbeat is missing/stale', () => {
    expect(deriveWorkerStatus(true, { healthy: false })).toBe('unhealthy');
  });

  it('is "unknown" — not "unhealthy" — when Redis itself is unreachable, regardless of the heartbeat result', () => {
    expect(deriveWorkerStatus(false, { healthy: false })).toBe('unknown');
    expect(deriveWorkerStatus(false, { healthy: true })).toBe('unknown');
  });
});
