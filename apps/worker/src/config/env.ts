import 'dotenv/config';
import { z } from 'zod';

/**
 * A separate, smaller schema than the API's — the worker never handles
 * HTTP, so it has no business requiring JWT_SECRET or CLIENT_URL. As of
 * Phase 4, the worker also needs UPLOAD_DIR (to read files the API's
 * upload endpoints wrote, and to write generated report/image output —
 * see docs/file-handling.md) and the SMTP settings for the EMAIL handler.
 *
 * As of Phase 9, it also needs EXTERNAL_REQUEST_TIMEOUT_MS and
 * EXTERNAL_MAX_RESPONSE_SIZE_MB. These already existed in
 * `.env.example` and in the API's own env schema, but were never read by
 * anything — the API never makes the outbound call, the worker does (see
 * utils/ssrf-guard.ts), so this is where they actually belong.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),

  UPLOAD_DIR: z.string().default('./uploads'),

  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_USER: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
  SMTP_FROM: z.string().default('noreply@taskflow.local'),

  EXTERNAL_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  EXTERNAL_MAX_RESPONSE_SIZE_MB: z.coerce.number().int().positive().default(5),

  // Phase 10.1: how often the worker writes a liveness heartbeat to
  // Redis, and how long that heartbeat stays valid before Redis's own
  // TTL expires it — see utils/heartbeat.ts. The timeout has to be
  // meaningfully larger than the interval so a single missed tick (a GC
  // pause, a burst of CPU-bound job handling briefly blocking the event
  // loop) doesn't flip the worker to "unhealthy" for no real reason; the
  // 3x default gives two full missed ticks of slack before that happens.
  WORKER_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(10_000),
  WORKER_HEARTBEAT_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
}).refine((data) => data.WORKER_HEARTBEAT_TIMEOUT_MS > data.WORKER_HEARTBEAT_INTERVAL_MS, {
  message: 'WORKER_HEARTBEAT_TIMEOUT_MS must be greater than WORKER_HEARTBEAT_INTERVAL_MS, or every heartbeat would already be stale by the time the next one is due',
  path: ['WORKER_HEARTBEAT_TIMEOUT_MS'],
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
