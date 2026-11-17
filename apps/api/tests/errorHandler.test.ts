import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import multer from 'multer';
import { afterEach, describe, expect, it, vi } from 'vitest';

// See the identical comment in authMiddleware.test.ts: errorHandler.ts
// pulls in config/logger.ts -> the @taskflow/shared barrel -> a live
// PrismaClient construction this file has no use for.
vi.mock('@taskflow/shared', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { errorHandler } from '../src/middleware/errorHandler';
import { NotFoundError, ConflictError } from '../src/utils/errors';
import { env } from '../src/config/env';

/**
 * A minimal real Express app whose routes each throw a different kind
 * of error synchronously — Express's own synchronous-handler error
 * catching forwards each one to errorHandler exactly the way a real
 * route/controller error would, the same reasoning as
 * authMiddleware.test.ts.
 */
function buildTestApp() {
  const app = express();

  app.get('/not-found', () => {
    throw new NotFoundError('Job');
  });

  app.get('/conflict', () => {
    throw new ConflictError('Cannot cancel a running job');
  });

  app.get('/validation', () => {
    z.object({ name: z.string() }).parse({}); // throws a real ZodError
  });

  app.get('/upload-too-big', () => {
    throw new multer.MulterError('LIMIT_FILE_SIZE');
  });

  app.get('/unknown-error', () => {
    throw new Error('internal failure: db password is hunter2');
  });

  app.use(errorHandler);
  return app;
}

describe('errorHandler', () => {
  const app = buildTestApp();
  const originalNodeEnv = env.NODE_ENV;

  afterEach(() => {
    (env as { NODE_ENV: string }).NODE_ENV = originalNodeEnv;
  });

  it('maps a NotFoundError to 404 with its own errorCode and message', async () => {
    const res = await request(app).get('/not-found');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      success: false,
      errorCode: 'JOB_NOT_FOUND',
      message: 'Job not found',
    });
  });

  it('maps a ConflictError to 409', async () => {
    const res = await request(app).get('/conflict');
    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe('CONFLICT');
  });

  it('maps a ZodError to 400 VALIDATION_ERROR with a details array', async () => {
    const res = await request(app).get('/validation');
    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    expect(Array.isArray(res.body.details)).toBe(true);
    expect(res.body.details.length).toBeGreaterThan(0);
    expect(res.body.details[0]).toHaveProperty('path');
    expect(res.body.details[0]).toHaveProperty('message');
  });

  it('maps a MulterError LIMIT_FILE_SIZE to 400 with a size-specific message', async () => {
    const res = await request(app).get('/upload-too-big');
    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('UPLOAD_ERROR');
    expect(res.body.message).toContain('MB');
  });

  it('maps an unexpected error to 500 INTERNAL_SERVER_ERROR', async () => {
    const res = await request(app).get('/unknown-error');
    expect(res.status).toBe(500);
    expect(res.body.errorCode).toBe('INTERNAL_SERVER_ERROR');
  });

  it('includes the real error message and a stack trace outside production', async () => {
    (env as { NODE_ENV: string }).NODE_ENV = 'development';
    const res = await request(app).get('/unknown-error');

    expect(res.body.message).toContain('hunter2');
    expect(typeof res.body.stack).toBe('string');
  });

  it('never leaks the real message or a stack trace in production — the whole point of this handler existing', async () => {
    (env as { NODE_ENV: string }).NODE_ENV = 'production';
    const res = await request(app).get('/unknown-error');

    expect(res.body.message).toBe('Internal server error');
    expect(res.body.message).not.toContain('hunter2');
    expect(res.body.stack).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
  });

  it("a typed AppError's own message is still returned in production — it was already written to be user-facing", async () => {
    (env as { NODE_ENV: string }).NODE_ENV = 'production';
    const res = await request(app).get('/not-found');

    expect(res.body.message).toBe('Job not found');
  });

  it('every error response, regardless of kind, has the same top-level shape', async () => {
    const endpoints = ['/not-found', '/conflict', '/validation', '/upload-too-big', '/unknown-error'];
    for (const endpoint of endpoints) {
      const res = await request(app).get(endpoint);
      expect(res.body.success).toBe(false);
      expect(typeof res.body.message).toBe('string');
      expect(typeof res.body.errorCode).toBe('string');
    }
  });
});
