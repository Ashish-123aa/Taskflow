import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

// config/logger.ts imports createLogger from the @taskflow/shared
// barrel, which also eagerly constructs a live PrismaClient (its
// index.ts re-exports packages/shared/src/prisma.ts) — nothing this
// file tests touches a database at all, so that construction is pure
// overhead here, and this sandbox's network restrictions mean
// `prisma generate` was never able to produce a real client for it to
// construct anyway (see docs/database.md). Mocking the barrel with just
// the one function this dependency chain actually needs sidesteps both
// problems without changing any production code.
vi.mock('@taskflow/shared', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { createRateLimiter, type RateLimitCounter } from '../src/middleware/rateLimit';
import { errorHandler } from '../src/middleware/errorHandler';

/**
 * A trivial in-memory stand-in for the Redis-backed counter — exactly
 * the kind of fake the DI seam in rateLimit.ts exists to make possible.
 * Fixed-window semantics only (no real expiry), which is all this
 * middleware's own logic needs exercised; the actual Redis atomicity is
 * covered separately in rateLimitRedisCounter.test.ts against a real
 * Redis instance.
 */
function createFakeCounter(): RateLimitCounter & { reset: () => void } {
  const counts = new Map<string, number>();
  return {
    async increment(key) {
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return next;
    },
    async ttl() {
      return 30; // arbitrary positive value — "not expired yet"
    },
    reset() {
      counts.clear();
    },
  };
}

function buildTestApp(counter: RateLimitCounter, options: Parameters<typeof createRateLimiter>[1]) {
  const app = express();
  app.get('/ping', createRateLimiter(counter, options), (_req, res) => {
    res.status(200).json({ success: true, data: 'pong' });
  });
  app.use(errorHandler);
  return app;
}

describe('createRateLimiter', () => {
  it('allows requests up to the configured max', async () => {
    const counter = createFakeCounter();
    const app = buildTestApp(counter, { windowMs: 60_000, max: 3, keyPrefix: 'test-allow' });

    for (let i = 0; i < 3; i += 1) {
      const res = await request(app).get('/ping');
      expect(res.status).toBe(200);
    }
  });

  it('rejects the request that exceeds the max with a 429 in the standard error shape', async () => {
    const counter = createFakeCounter();
    const app = buildTestApp(counter, { windowMs: 60_000, max: 2, keyPrefix: 'test-reject' });

    await request(app).get('/ping');
    await request(app).get('/ping');
    const res = await request(app).get('/ping');

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ success: false, errorCode: 'TOO_MANY_REQUESTS' });
    expect(typeof res.body.message).toBe('string');
  });

  it('sets RateLimit-Limit and RateLimit-Remaining on every response', async () => {
    const counter = createFakeCounter();
    const app = buildTestApp(counter, { windowMs: 60_000, max: 5, keyPrefix: 'test-headers' });

    const first = await request(app).get('/ping');
    expect(first.headers['ratelimit-limit']).toBe('5');
    expect(first.headers['ratelimit-remaining']).toBe('4');

    const second = await request(app).get('/ping');
    expect(second.headers['ratelimit-remaining']).toBe('3');
  });

  it('sets a Retry-After header once the limit is exceeded', async () => {
    const counter = createFakeCounter();
    const app = buildTestApp(counter, { windowMs: 60_000, max: 1, keyPrefix: 'test-retry-after' });

    await request(app).get('/ping');
    const res = await request(app).get('/ping');

    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('tracks different keys (identities) independently', async () => {
    const counter = createFakeCounter();
    const app = express();
    app.get(
      '/ping',
      createRateLimiter(counter, {
        windowMs: 60_000,
        max: 1,
        keyPrefix: 'test-per-key',
        keyGenerator: (req) => String(req.query.user),
      }),
      (_req, res) => res.status(200).json({ success: true }),
    );
    app.use(errorHandler);

    const aliceFirst = await request(app).get('/ping').query({ user: 'alice' });
    const bobFirst = await request(app).get('/ping').query({ user: 'bob' });
    const aliceSecond = await request(app).get('/ping').query({ user: 'alice' });

    expect(aliceFirst.status).toBe(200);
    expect(bobFirst.status).toBe(200); // bob's own budget, untouched by alice's usage
    expect(aliceSecond.status).toBe(429); // alice's second request, same key as her first
  });

  it('fails open (lets the request through) when the counter throws', async () => {
    const failingCounter: RateLimitCounter = {
      increment: () => Promise.reject(new Error('ECONNREFUSED')),
      ttl: () => Promise.resolve(-1),
    };
    const app = buildTestApp(failingCounter, { windowMs: 60_000, max: 1, keyPrefix: 'test-fail-open' });

    const res = await request(app).get('/ping');

    expect(res.status).toBe(200);
  });

  it('does not throw the client off entirely if the TTL lookup fails after an over-limit increment', async () => {
    const counter: RateLimitCounter = {
      increment: () => Promise.resolve(2), // already over a max of 1
      ttl: () => Promise.reject(new Error('ECONNREFUSED')),
    };
    const app = buildTestApp(counter, { windowMs: 60_000, max: 1, keyPrefix: 'test-ttl-fail' });

    const res = await request(app).get('/ping');

    // Still correctly rejected — a broken TTL lookup only degrades the
    // precision of Retry-After, not whether the limit is enforced.
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
  });
});
