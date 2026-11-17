import 'dotenv/config';
import { z } from 'zod';

/**
 * Every environment variable the API reads, validated once at startup
 * (section 40: "If a required environment variable is missing, fail with
 * a clear error"). This turns a silently-undefined JWT_SECRET or a typo'd
 * DATABASE_URL into an immediate, readable crash on boot instead of a
 * confusing failure the first time that variable is actually used.
 *
 * As of Phase 9, it also validates the three rate-limit budgets
 * (section 25) — each configurable independently rather than hardcoded,
 * so a deployment can tune them (e.g. a stricter auth limit in
 * production) without a code change. See middleware/rateLimit.ts for how
 * these are actually enforced.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  CLIENT_URL: z.string().url().default('http://localhost:5173'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),

  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),

  MAX_UPLOAD_SIZE_MB: z.coerce.number().int().positive().default(50),
  UPLOAD_DIR: z.string().default('./uploads'),

  EXTERNAL_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  EXTERNAL_MAX_RESPONSE_SIZE_MB: z.coerce.number().int().positive().default(5),

  // Authentication (register/login): the spec's own example — 5 attempts
  // per minute per IP. Deliberately the tightest of the three; this is
  // the endpoint category most worth throttling hard, since it's what a
  // credential-stuffing or account-enumeration attempt actually hits.
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(5),
  RATE_LIMIT_AUTH_WINDOW_MS: z.coerce.number().int().positive().default(60_000),

  // Every other authenticated (or not-yet-authenticated) request under
  // /api/v1 — a coarse, IP-scoped ceiling against generic abuse, not a
  // precise per-feature budget.
  RATE_LIMIT_API_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_API_WINDOW_MS: z.coerce.number().int().positive().default(60_000),

  // Job creation specifically (POST /jobs and the two upload endpoints,
  // which create a job exactly the same way) — scoped per authenticated
  // user rather than per IP, since job creation always requires a
  // logged-in account already.
  RATE_LIMIT_JOB_CREATE_MAX: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_JOB_CREATE_WINDOW_MS: z.coerce.number().int().positive().default(60_000),

  // Section 26: "cache the result briefly" — GET /dashboard/stats runs a
  // handful of Prisma aggregate queries on every dashboard page load; a
  // short TTL absorbs repeated/rapid requests (a page refresh, several
  // open tabs) without letting the numbers go stale for long. See
  // services/dashboardCache.ts for the invalidation side of this — a
  // real job-status change invalidates the cache immediately rather than
  // waiting out the TTL.
  DASHBOARD_STATS_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(30),
});

function loadEnv() {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error('Invalid environment variables:');
    for (const issue of parsed.error.issues) {
      // eslint-disable-next-line no-console
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }

  return parsed.data;
}

export const env = loadEnv();
export type Env = typeof env;
