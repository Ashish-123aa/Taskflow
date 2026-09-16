import { afterAll, afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '@taskflow/shared';
import { createApp } from '../src/app';
import { jobQueue } from '../src/queues/job.queue';

const app = createApp();
const EMAIL_DOMAIN = '@test.taskflow.local';
const SAMPLE_URL = 'https://api.open-meteo.com/v1/forecast?latitude=0&longitude=0';

async function registerAsAdmin(email: string) {
  const agent = request.agent(app);
  await agent.post('/api/v1/auth/register').send({ name: 'Admin Test', email, password: 'Password123' });

  // Promoting the role in the database alone isn't enough — the JWT
  // issued at registration already has role: "USER" baked into it, and
  // the auth middleware reads the role from the token, not a fresh
  // database lookup (see docs/security.md, "stateless JWT trade-off").
  // Logging in again issues a new token reflecting the promoted role.
  await prisma.user.update({ where: { email }, data: { role: 'ADMIN' } });
  await agent.post('/api/v1/auth/login').send({ email, password: 'Password123' });

  return agent;
}

describe('Admin', () => {
  afterEach(async () => {
    await prisma.job.deleteMany({ where: { user: { email: { endsWith: EMAIL_DOMAIN } } } });
    await prisma.auditLog.deleteMany({ where: { user: { email: { endsWith: EMAIL_DOMAIN } } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: EMAIL_DOMAIN } } });
  });

  afterAll(async () => {
    await jobQueue.close();
    await prisma.$disconnect();
  });

  describe('route protection', () => {
    it('rejects an unauthenticated request to admin routes', async () => {
      const res = await request(app).get('/api/v1/admin/jobs');
      expect(res.status).toBe(401);
    });

    it('rejects a regular (non-admin) user from admin routes', async () => {
      const agent = request.agent(app);
      await agent
        .post('/api/v1/auth/register')
        .send({ name: 'Regular', email: `regular${EMAIL_DOMAIN}`, password: 'Password123' });

      const res = await agent.get('/api/v1/admin/jobs');
      expect(res.status).toBe(403);
      expect(res.body.errorCode).toBe('FORBIDDEN');
    });
  });

  describe('GET /api/v1/admin/jobs', () => {
    it("returns jobs across every user, not just the admin's own", async () => {
      const admin = await registerAsAdmin(`admin1${EMAIL_DOMAIN}`);

      const otherUser = request.agent(app);
      await otherUser
        .post('/api/v1/auth/register')
        .send({ name: 'Other', email: `other1${EMAIL_DOMAIN}`, password: 'Password123' });
      await otherUser
        .post('/api/v1/jobs')
        .send({ name: "Other user's job", type: 'API_REQUEST', payload: { url: SAMPLE_URL } });

      const res = await admin.get('/api/v1/admin/jobs');
      expect(res.status).toBe(200);
      const names = (res.body.data as Array<{ name: string }>).map((j) => j.name);
      expect(names).toContain("Other user's job");
    });

    it('filters by status, which is how dead-letter jobs are inspected (section 13)', async () => {
      const admin = await registerAsAdmin(`admin2${EMAIL_DOMAIN}`);
      const res = await admin.get('/api/v1/admin/jobs').query({ status: 'DEAD_LETTER' });
      expect(res.status).toBe(200);
      for (const job of res.body.data as Array<{ status: string }>) {
        expect(job.status).toBe('DEAD_LETTER');
      }
    });
  });

  describe("regular users no longer see everyone's jobs on GET /jobs", () => {
    it("an admin's personal /jobs list does not include another user's job", async () => {
      const admin = await registerAsAdmin(`admin3${EMAIL_DOMAIN}`);

      const otherUser = request.agent(app);
      await otherUser
        .post('/api/v1/auth/register')
        .send({ name: 'Other', email: `other3${EMAIL_DOMAIN}`, password: 'Password123' });
      await otherUser
        .post('/api/v1/jobs')
        .send({ name: "Someone else's job", type: 'API_REQUEST', payload: { url: SAMPLE_URL } });

      const res = await admin.get('/api/v1/jobs');
      const names = (res.body.data as Array<{ name: string }>).map((j) => j.name);
      expect(names).not.toContain("Someone else's job");
    });
  });

  describe('GET /api/v1/admin/users', () => {
    it('lists users without ever including passwordHash', async () => {
      const admin = await registerAsAdmin(`admin4${EMAIL_DOMAIN}`);
      const res = await admin.get('/api/v1/admin/users');
      expect(res.status).toBe(200);
      for (const user of res.body.data as Array<Record<string, unknown>>) {
        expect(user.passwordHash).toBeUndefined();
      }
    });
  });

  describe('PATCH /api/v1/admin/users/:id', () => {
    it('disables a user, who can no longer log in afterward', async () => {
      const admin = await registerAsAdmin(`admin5${EMAIL_DOMAIN}`);

      const targetEmail = `target5${EMAIL_DOMAIN}`;
      await request(app)
        .post('/api/v1/auth/register')
        .send({ name: 'Target', email: targetEmail, password: 'Password123' });
      const target = await prisma.user.findUniqueOrThrow({ where: { email: targetEmail } });

      const disableRes = await admin
        .patch(`/api/v1/admin/users/${target.id}`)
        .send({ isActive: false });
      expect(disableRes.status).toBe(200);
      expect(disableRes.body.data.isActive).toBe(false);

      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: targetEmail, password: 'Password123' });
      expect(loginRes.status).toBe(403);
    });

    it('refuses to let an admin disable their own account', async () => {
      const admin = await registerAsAdmin(`admin6${EMAIL_DOMAIN}`);
      const adminUser = await prisma.user.findUniqueOrThrow({
        where: { email: `admin6${EMAIL_DOMAIN}` },
      });

      const res = await admin.patch(`/api/v1/admin/users/${adminUser.id}`).send({ isActive: false });
      expect(res.status).toBe(400);
    });

    it('records an audit log entry for the disable action', async () => {
      const admin = await registerAsAdmin(`admin7${EMAIL_DOMAIN}`);
      const targetEmail = `target7${EMAIL_DOMAIN}`;
      await request(app)
        .post('/api/v1/auth/register')
        .send({ name: 'Target', email: targetEmail, password: 'Password123' });
      const target = await prisma.user.findUniqueOrThrow({ where: { email: targetEmail } });

      await admin.patch(`/api/v1/admin/users/${target.id}`).send({ isActive: false });

      const logs = await prisma.auditLog.findMany({
        where: { resource: 'User', resourceId: target.id, action: 'USER_DISABLED' },
      });
      expect(logs).toHaveLength(1);
    });
  });

  describe("admin acting on another user's job", () => {
    it('can cancel a queued job it does not own, and the action is audited', async () => {
      const admin = await registerAsAdmin(`admin8${EMAIL_DOMAIN}`);

      const owner = request.agent(app);
      await owner
        .post('/api/v1/auth/register')
        .send({ name: 'Owner', email: `owner8${EMAIL_DOMAIN}`, password: 'Password123' });
      const createRes = await owner
        .post('/api/v1/jobs')
        .send({ name: "Owner's job", type: 'API_REQUEST', payload: { url: SAMPLE_URL } });
      const jobId = createRes.body.data.id;

      const cancelRes = await admin.post(`/api/v1/jobs/${jobId}/cancel`);
      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.data.status).toBe('CANCELLED');

      const logs = await prisma.auditLog.findMany({
        where: { resource: 'Job', resourceId: jobId, action: 'ADMIN_JOB_CANCEL' },
      });
      expect(logs).toHaveLength(1);
    });

    it("does not audit-log a user cancelling their own job", async () => {
      const owner = request.agent(app);
      await owner
        .post('/api/v1/auth/register')
        .send({ name: 'SelfOwner', email: `selfowner8${EMAIL_DOMAIN}`, password: 'Password123' });
      const createRes = await owner
        .post('/api/v1/jobs')
        .send({ name: 'My own job', type: 'API_REQUEST', payload: { url: SAMPLE_URL } });
      const jobId = createRes.body.data.id;

      await owner.post(`/api/v1/jobs/${jobId}/cancel`);

      const logs = await prisma.auditLog.findMany({
        where: { resource: 'Job', resourceId: jobId, action: 'ADMIN_JOB_CANCEL' },
      });
      expect(logs).toHaveLength(0);
    });
  });
});
