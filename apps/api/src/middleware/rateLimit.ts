import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Redis } from 'ioredis';
import { TooManyRequestsError } from '../utils/errors';
import { logger } from '../config/logger';

/**
 * The counting mechanism a rate limiter needs, kept separate from the
 * Express middleware itself (below) for the same reason
 * `createEmailHandler` takes a `Transporter` and `createJobEventPublisher`
 * takes a Redis connection as a parameter instead of constructing one
 * internally: it's what actually needs testing, and it can be tested
 * against a trivial in-memory fake with no real Redis connection at all
 * — see tests/rateLimit.test.ts. `rateLimiters.ts` wires a real one up
 * via `createRedisRateLimitCounter` below for production use.
 */
export interface RateLimitCounter {
  /**
   * Atomically increments the counter for `key`, setting it to expire
   * after `windowSeconds` the first time it's created, and returns the
   * new count.
   */
  increment(key: string, windowSeconds: number): Promise<number>;
  /**
   * Seconds remaining before `key` expires and its window resets, or a
   * non-positive number if it has no TTL (e.g. it doesn't exist).
   */
  ttl(key: string): Promise<number>;
}

// INCR, then "set an expiry, but only the very first time", in one
// atomic round trip. Without the Lua script, a plain INCR followed by a
// separate EXPIRE call leaves a window where a crash (or just ordinary
// concurrent requests) between the two commands could either leave a key
// with no expiry at all — a counter that never resets — or push the
// expiry back on every single request — a window that never actually
// closes. The whole point of "N per minute" breaks if that happens even
// occasionally under real traffic, so this has to be one Redis
// round-trip, not two.
const INCREMENT_WITH_EXPIRE_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return current
`;

interface RateLimitRedis extends Redis {
  rateLimitIncrement(key: string, windowSeconds: number): Promise<number>;
}

function hasRateLimitCommand(redis: Redis): redis is RateLimitRedis {
  return typeof (redis as unknown as Partial<RateLimitRedis>).rateLimitIncrement === 'function';
}

/**
 * Wires a real Redis connection up as a `RateLimitCounter`, using the Lua
 * script above for the atomic increment-and-maybe-expire. Safe to call
 * more than once against the same connection — ioredis's `defineCommand`
 * just re-registers the same script, a harmless no-op — though in
 * practice `rateLimiters.ts` only does it once and shares the result
 * across every limiter in the app.
 */
export function createRedisRateLimitCounter(redis: Redis): RateLimitCounter {
  if (!hasRateLimitCommand(redis)) {
    redis.defineCommand('rateLimitIncrement', {
      numberOfKeys: 1,
      lua: INCREMENT_WITH_EXPIRE_SCRIPT,
    });
  }
  const client = redis as RateLimitRedis;

  return {
    increment: (key, windowSeconds) => client.rateLimitIncrement(key, windowSeconds),
    ttl: (key) => redis.ttl(key),
  };
}

export interface RateLimitOptions {
  /** The size of the counting window, in milliseconds. */
  windowMs: number;
  /** How many requests are allowed per window before a 429. */
  max: number;
  /**
   * Namespaces this limiter's Redis keys (e.g. "auth", "api",
   * "job-create") so different limiters never share a counter, even if
   * two callers happen to produce the same identifier.
   */
  keyPrefix: string;
  /**
   * Identifies *who* is being limited. Defaults to the caller's IP —
   * pass one keyed on `req.user.id` instead for a per-account budget
   * (see the job-creation limiter in rateLimiters.ts).
   */
  keyGenerator?: (req: Request) => string;
}

const byIp = (req: Request): string => req.ip || 'unknown';

/**
 * Builds an Express middleware enforcing `max` requests per `windowMs`
 * per key, counted via `counter` (a real Redis-backed one in production,
 * a fake in-memory one in tests). Sets the standard `RateLimit-*`
 * headers on every response, and, once the limit is exceeded, a
 * `Retry-After` header plus a 429 via `TooManyRequestsError` — passed to
 * `next()` so it flows through the app's normal centralized error
 * handler (middleware/errorHandler.ts) rather than building its own
 * response shape.
 *
 * This is a fixed-window counter, not a sliding one: "20 per minute"
 * means 20 within whichever wall-clock minute Redis's EXPIRE happens to
 * land on for that key, not 20 within any rolling 60-second span. That
 * means a burst right at a window boundary — a few requests just before
 * it resets, a few more right after — can momentarily exceed the stated
 * rate over a short span straddling two windows. That's a known,
 * accepted imprecision for the coarse "abuse/brute-force protection,"
 * not "billing-grade accounting" budgets this project needs (a sliding
 * window, e.g. a Redis sorted set of timestamps, would close that gap at
 * the cost of more Redis memory and a slightly more expensive check per
 * request — a reasonable upgrade if this ever needs to be exact).
 *
 * Fails OPEN, not closed: if the counter itself throws (e.g. Redis is
 * temporarily unreachable), this logs a warning and lets the request
 * through uncounted, rather than turning a Redis blip into a site-wide
 * 500 on every single request. Section 55's "Redis unavailable" failure
 * scenario is about the app staying up, not about rate limiting being
 * perfectly enforced during an outage — a few uncounted requests during
 * a brief Redis hiccup is a far smaller problem than that.
 */
export function createRateLimiter(counter: RateLimitCounter, options: RateLimitOptions): RequestHandler {
  const windowSeconds = Math.max(1, Math.ceil(options.windowMs / 1000));
  const keyGenerator = options.keyGenerator ?? byIp;

  return function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
    const key = `ratelimit:${options.keyPrefix}:${keyGenerator(req)}`;

    counter
      .increment(key, windowSeconds)
      .then(async (count) => {
        res.setHeader('RateLimit-Limit', String(options.max));
        res.setHeader('RateLimit-Remaining', String(Math.max(options.max - count, 0)));

        if (count <= options.max) {
          next();
          return;
        }

        let retryAfterSeconds = windowSeconds;
        try {
          const ttl = await counter.ttl(key);
          if (ttl > 0) retryAfterSeconds = ttl;
        } catch {
          // The increment above already succeeded, so the count itself
          // is trustworthy even if this follow-up TTL lookup fails —
          // worst case, Retry-After is just less precise (the full
          // window, rather than however much of it is actually left).
        }
        res.setHeader('Retry-After', String(retryAfterSeconds));
        next(new TooManyRequestsError());
      })
      .catch((err: unknown) => {
        logger.warn('Rate limiter failed open due to a counter error', {
          keyPrefix: options.keyPrefix,
          error: err,
        });
        next();
      });
  };
}
