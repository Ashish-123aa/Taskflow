import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '@taskflow/shared';
import { createApp } from '../src/app';

const app = createApp();

// All test accounts use this domain so cleanup can target exactly the rows
// this suite created, and nothing else in a shared dev database.
const TEST_EMAIL_DOMAIN = '@test.taskflow.local';

describe('Auth', () => {
  afterEach(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('POST /api/v1/auth/register', () => {
    it('creates a new user and never returns the password hash', async () => {
      const res = await request(app).post('/api/v1/auth/register').send({
        name: 'Test User',
        email: `new-user${TEST_EMAIL_DOMAIN}`,
        password: 'Password123',
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.email).toBe(`new-user${TEST_EMAIL_DOMAIN}`);
      expect(res.body.data.passwordHash).toBeUndefined();
      expect(res.headers['set-cookie']?.[0]).toMatch(/taskflow_token=/);
    });

    it('rejects a duplicate email', async () => {
      const payload = {
        name: 'Test User',
        email: `dup${TEST_EMAIL_DOMAIN}`,
        password: 'Password123',
      };
      await request(app).post('/api/v1/auth/register').send(payload);
      const res = await request(app).post('/api/v1/auth/register').send(payload);

      expect(res.status).toBe(409);
      expect(res.body.errorCode).toBe('CONFLICT');
    });

    it('rejects a password that fails the strength requirements', async () => {
      const res = await request(app).post('/api/v1/auth/register').send({
        name: 'Test User',
        email: `weak${TEST_EMAIL_DOMAIN}`,
        password: 'short',
      });

      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/v1/auth/login', () => {
    beforeAll(async () => {
      await request(app).post('/api/v1/auth/register').send({
        name: 'Login Test',
        email: `login${TEST_EMAIL_DOMAIN}`,
        password: 'Password123',
      });
    });

    afterAll(async () => {
      await prisma.user.deleteMany({ where: { email: `login${TEST_EMAIL_DOMAIN}` } });
    });

    it('logs in with correct credentials', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: `login${TEST_EMAIL_DOMAIN}`, password: 'Password123' });

      expect(res.status).toBe(200);
      expect(res.body.data.email).toBe(`login${TEST_EMAIL_DOMAIN}`);
    });

    it('rejects an invalid password', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: `login${TEST_EMAIL_DOMAIN}`, password: 'WrongPassword123' });

      expect(res.status).toBe(401);
      expect(res.body.errorCode).toBe('UNAUTHORIZED');
    });

    it('returns the same error for a nonexistent email as for a wrong password', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: `nobody${TEST_EMAIL_DOMAIN}`, password: 'Password123' });

      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Invalid email or password');
    });
  });

  describe('GET /api/v1/auth/me', () => {
    it('rejects an unauthenticated request', async () => {
      const res = await request(app).get('/api/v1/auth/me');
      expect(res.status).toBe(401);
      expect(res.body.errorCode).toBe('UNAUTHORIZED');
    });

    it('returns the current user when authenticated via the session cookie', async () => {
      const agent = request.agent(app); // persists cookies across requests
      await agent.post('/api/v1/auth/register').send({
        name: 'Me Test',
        email: `me${TEST_EMAIL_DOMAIN}`,
        password: 'Password123',
      });

      const res = await agent.get('/api/v1/auth/me');
      expect(res.status).toBe(200);
      expect(res.body.data.email).toBe(`me${TEST_EMAIL_DOMAIN}`);
    });
  });
});
