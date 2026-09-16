import 'dotenv/config';
import { z } from 'zod';

/**
 * Every environment variable the API reads, validated once at startup
 * (section 40: "If a required environment variable is missing, fail with
 * a clear error"). This turns a silently-undefined JWT_SECRET or a typo'd
 * DATABASE_URL into an immediate, readable crash on boot instead of a
 * confusing failure the first time that variable is actually used.
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
