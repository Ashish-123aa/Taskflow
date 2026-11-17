import Redis from 'ioredis';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

// config/redis.ts and utils/heartbeat.ts both import from the
// @taskflow/shared barrel, whose index.ts also re-exports
// packages/shared/src/prisma.ts — which constructs a live PrismaClient
// at import time. This sandbox's network restrictions mean
// `prisma generate` never produced a real client for it to construct
// (see docs/database.md), so importing the real barrel throws before
// this file's own code ever runs. The mock below re-implements only the
// two pieces of the barrel this dependency chain actually needs —
// `createRedisConnection` using the *real* ioredis constructor (this
// test needs a genuine, working connection to verify against, not a
// stub) and `WORKER_HEARTBEAT_KEY`'s real value — sidestepping the
// Prisma export entirely without touching any production code.
vi.mock('@taskflow/shared', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  createRedisConnection: (url: string) => new Redis(url, { maxRetriesPerRequest: null }),
  WORKER_HEARTBEAT_KEY: 'worker:heartbeat:last',
}));

import { WORKER_HEARTBEAT_KEY } from '@taskflow/shared';
import { startHeartbeat, stopHeartbeat, clearHeartbeat } from '../src/utils/heartbeat';

// A second, independent connection used only to inspect what the
// heartbeat module (which uses the worker's own shared `redisConnection`
// under the hood) actually wrote — kept separate so this test never
// needs to reach into that module's internals.
const inspector = new Redis('redis://127.0.0.1:6379', { maxRetriesPerRequest: null });

describe('worker heartbeat', () => {
  afterEach(async () => {
    await inspector.del(WORKER_HEARTBEAT_KEY);
  });

  afterAll(async () => {
    await inspector.quit();
  });

  it('writes a heartbeat immediately on start, without waiting a full interval', async () => {
    const timer = startHeartbeat(50, 1000);
    try {
      // A short poll rather than a fixed sleep — the write happens on
      // the next microtask/tick after startHeartbeat() returns, not
      // synchronously within the call itself.
      const value = await waitFor(() => inspector.get(WORKER_HEARTBEAT_KEY));
      expect(value).not.toBeNull();
      expect(new Date(value!).toString()).not.toBe('Invalid Date');
    } finally {
      stopHeartbeat(timer);
    }
  });

  it('sets a TTL derived from the configured timeout', async () => {
    const timer = startHeartbeat(50, 5000);
    try {
      await waitFor(() => inspector.get(WORKER_HEARTBEAT_KEY));
      const ttl = await inspector.ttl(WORKER_HEARTBEAT_KEY);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(5);
    } finally {
      stopHeartbeat(timer);
    }
  });

  it('refreshes the heartbeat on every interval tick', async () => {
    const timer = startHeartbeat(50, 1000);
    try {
      const first = await waitFor(() => inspector.get(WORKER_HEARTBEAT_KEY));
      await new Promise((resolve) => setTimeout(resolve, 120));
      const second = await inspector.get(WORKER_HEARTBEAT_KEY);

      expect(second).not.toBeNull();
      expect(new Date(second!).getTime()).toBeGreaterThanOrEqual(new Date(first!).getTime());
    } finally {
      stopHeartbeat(timer);
    }
  });

  it('stopHeartbeat halts further writes, so the key eventually expires on its own', async () => {
    const timer = startHeartbeat(50, 1); // 1-second TTL
    await waitFor(() => inspector.get(WORKER_HEARTBEAT_KEY));
    stopHeartbeat(timer);

    await new Promise((resolve) => setTimeout(resolve, 1300));
    expect(await inspector.get(WORKER_HEARTBEAT_KEY)).toBeNull();
  });

  it('clearHeartbeat removes the key immediately, ahead of its TTL', async () => {
    const timer = startHeartbeat(50, 3600); // long TTL — only an explicit clear should remove it this fast
    try {
      await waitFor(() => inspector.get(WORKER_HEARTBEAT_KEY));
      await clearHeartbeat();
      expect(await inspector.get(WORKER_HEARTBEAT_KEY)).toBeNull();
    } finally {
      stopHeartbeat(timer);
    }
  });

  it('clearHeartbeat does not throw when there is no heartbeat key to clear', async () => {
    await expect(clearHeartbeat()).resolves.not.toThrow();
  });
});

async function waitFor<T>(fn: () => Promise<T | null>, timeoutMs = 2000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await fn();
    if (value !== null && value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('waitFor: condition never became true within the timeout');
}
