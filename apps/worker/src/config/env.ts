import 'dotenv/config';
import { z } from 'zod';

/**
 * A separate, smaller schema than the API's — the worker never handles
 * HTTP, so it has no business requiring JWT_SECRET or CLIENT_URL. As of
 * Phase 4, the worker also needs UPLOAD_DIR (to read files the API's
 * upload endpoints wrote, and to write generated report/image output —
 * see docs/file-handling.md) and the SMTP settings for the EMAIL handler.
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
