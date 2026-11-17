import type { Request } from 'express';
import { createRateLimiter, createRedisRateLimitCounter } from './rateLimit';
import { redisConnection } from '../config/redis';
import { env } from '../config/env';

// One counter, shared by every limiter below — they're already kept
// from colliding by each limiter's own `keyPrefix`, so there's no reason
// to register the Lua script or hold a second reference per limiter.
const counter = createRedisRateLimitCounter(redisConnection);

/**
 * Register and login (section 25: "Authentication: 5 attempts /
 * minute"). Both share one bucket, keyed by IP — splitting them into two
 * separate budgets would just let an attacker double their effective
 * attempt rate by alternating between the two endpoints instead of
 * hammering one.
 */
export const authRateLimiter = createRateLimiter(counter, {
  windowMs: env.RATE_LIMIT_AUTH_WINDOW_MS,
  max: env.RATE_LIMIT_AUTH_MAX,
  keyPrefix: 'auth',
});

/**
 * Everything under /api/v1 (section 25: "Normal API: 100 requests /
 * minute"). Mounted once in app.ts, ahead of every route — including
 * ones that go on to require auth — so it's keyed by IP rather than by
 * user: at this point in the middleware chain, nothing has verified who
 * (if anyone) is logged in yet.
 */
export const apiRateLimiter = createRateLimiter(counter, {
  windowMs: env.RATE_LIMIT_API_WINDOW_MS,
  max: env.RATE_LIMIT_API_MAX,
  keyPrefix: 'api',
});

/**
 * Job creation specifically (section 25: "Job creation: 20 jobs /
 * minute") — applied to POST /jobs and both upload endpoints, all three
 * of which create a job the same way (jobService.createJob). Unlike the
 * two limiters above, this one only ever runs after `authenticate`
 * (job.routes.ts applies that to the whole router first), so `req.user`
 * is always set by the time this key generator runs. Scoping the budget
 * to the account rather than the IP means one person can't exhaust
 * someone else's quota just by sharing a NAT gateway or corporate proxy
 * — the `?? req.ip` fallback only matters if this were ever mounted
 * somewhere `authenticate` hadn't already run, which it isn't.
 */
export const jobCreateRateLimiter = createRateLimiter(counter, {
  windowMs: env.RATE_LIMIT_JOB_CREATE_WINDOW_MS,
  max: env.RATE_LIMIT_JOB_CREATE_MAX,
  keyPrefix: 'job-create',
  keyGenerator: (req: Request) => req.user?.id ?? req.ip ?? 'unknown',
});
