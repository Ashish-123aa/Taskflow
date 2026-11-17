import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

// errorHandler.ts imports config/logger.ts, which imports createLogger
// from the @taskflow/shared barrel — and with it a live PrismaClient
// construction this file has no use for and this sandbox can't generate
// (see the identical comment in rateLimit.test.ts). authenticate/
// authorize themselves only need `Role` from @taskflow/shared, which is
// a type-only import and is erased entirely — no mock needed for that
// half.
vi.mock('@taskflow/shared', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { authenticate, authorize } from '../src/middleware/auth';
import { errorHandler } from '../src/middleware/errorHandler';
import { signToken } from '../src/services/token.service';

const COOKIE_NAME = 'taskflow_token';

/**
 * A minimal real Express app — cookie parsing, the actual authenticate/
 * authorize middleware under test, and the actual centralized error
 * handler, all wired the same way app.ts wires them. Both `authenticate`
 * and `authorize` throw directly (rather than calling `next(err)`) and
 * rely on Express's own synchronous-middleware error handling to route
 * that into errorHandler — so this needs a genuine Express dispatch to
 * test faithfully, not a bare function call with mocked req/res/next.
 */
function buildTestApp() {
  const app = express();
  app.use(cookieParser());

  app.get('/whoami', authenticate, (req, res) => {
    res.status(200).json({ success: true, data: req.user });
  });

  app.get('/admin-only', authenticate, authorize('ADMIN'), (_req, res) => {
    res.status(200).json({ success: true, data: 'secret admin data' });
  });

  app.use(errorHandler);
  return app;
}

describe('authenticate', () => {
  const app = buildTestApp();

  it('rejects a request with no cookie at all', async () => {
    const res = await request(app).get('/whoami');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ success: false, errorCode: 'UNAUTHORIZED' });
  });

  it('rejects a garbage cookie value', async () => {
    const res = await request(app).get('/whoami').set('Cookie', `${COOKIE_NAME}=not-a-real-jwt`);
    expect(res.status).toBe(401);
  });

  it('rejects an expired token', async () => {
    const jwt = await import('jsonwebtoken');
    const expired = jwt.default.sign(
      { sub: 'user-1', role: 'USER' },
      process.env.JWT_SECRET as string,
      { expiresIn: -10 },
    );
    const res = await request(app).get('/whoami').set('Cookie', `${COOKIE_NAME}=${expired}`);
    expect(res.status).toBe(401);
  });

  it('accepts a valid token and populates req.user with exactly the token\'s claims', async () => {
    const token = signToken({ sub: 'user-42', role: 'USER' });
    const res = await request(app).get('/whoami').set('Cookie', `${COOKIE_NAME}=${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: 'user-42', role: 'USER' });
  });

  it('never leaks a stack trace or internal detail in the 401 body', async () => {
    const res = await request(app).get('/whoami');
    expect(res.body.stack).toBeUndefined();
    expect(res.body.message).toBe('Authentication required');
  });
});

describe('authorize', () => {
  const app = buildTestApp();

  it('rejects an unauthenticated request before ever reaching the role check', async () => {
    const res = await request(app).get('/admin-only');
    expect(res.status).toBe(401);
    expect(res.body.errorCode).toBe('UNAUTHORIZED');
  });

  it('rejects a valid, authenticated USER from an ADMIN-only route', async () => {
    const token = signToken({ sub: 'user-1', role: 'USER' });
    const res = await request(app).get('/admin-only').set('Cookie', `${COOKIE_NAME}=${token}`);

    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBe('FORBIDDEN');
  });

  it('allows a valid ADMIN through to the protected route', async () => {
    const token = signToken({ sub: 'admin-1', role: 'ADMIN' });
    const res = await request(app).get('/admin-only').set('Cookie', `${COOKIE_NAME}=${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBe('secret admin data');
  });
});
