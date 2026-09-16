import { afterAll, afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '@taskflow/shared';
import { createApp } from '../src/app';
import { jobQueue } from '../src/queues/job.queue';
import { runDueSchedules } from '../src/scheduler/scheduler';

const app = createApp();
const EMAIL_DOMAIN = '@test.taskflow.local';
const SAMPLE_URL = 'https://api.open-meteo.com/v1/forecast?latitude=0&longitude=0';

async function registerAndLogin(agent: ReturnType<typeof request.agent>, email: string) {
  await agent
    .post('/api/v1/auth/register')
    .send({ name: 'Schedule Test User', email, password: 'Password123' });
}

describe('Schedules', () => {
  afterEach(async () => {
    await prisma.job.deleteMany({ where: { user: { email: { endsWith: EMAIL_DOMAIN } } } });
    await prisma.schedule.deleteMany({ where: { user: { email: { endsWith: EMAIL_DOMAIN } } } });
    await prisma.notification.deleteMany({ where: { user: { email: { endsWith: EMAIL_DOMAIN } } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: EMAIL_DOMAIN } } });
  });

  afterAll(async () => {
    await jobQueue.close();
    await prisma.$disconnect();
  });

  describe('POST /api/v1/schedules', () => {
    it('creates a schedule with a computed nextRunAt', async () => {
      const agent = request.agent(app);
      await registerAndLogin(agent, `create1${EMAIL_DOMAIN}`);

      const res = await agent.post('/api/v1/schedules').send({
        name: 'Daily weather',
        jobType: 'API_REQUEST',
        cronExpression: '0 8 * * *',
        payload: { url: SAMPLE_URL },
      });

      expect(res.status).toBe(201);
      expect(res.body.data.nextRunAt).toBeTruthy();
      expect(res.body.data.isActive).toBe(true);
    });

    it('rejects an invalid cron expression', async () => {
      const agent = request.agent(app);
      await registerAndLogin(agent, `create2${EMAIL_DOMAIN}`);

      const res = await agent.post('/api/v1/schedules').send({
        name: 'Bad cron',
        jobType: 'API_REQUEST',
        cronExpression: 'not-a-cron',
        payload: { url: SAMPLE_URL },
      });

      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    });

    it('rejects a payload that is invalid for the given job type', async () => {
      const agent = request.agent(app);
      await registerAndLogin(agent, `create3${EMAIL_DOMAIN}`);

      const res = await agent.post('/api/v1/schedules').send({
        name: 'Bad payload',
        jobType: 'API_REQUEST',
        cronExpression: '0 8 * * *',
        payload: { notAUrl: true },
      });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/v1/schedules', () => {
    it("lists only the requesting user's own schedules", async () => {
      const owner = request.agent(app);
      await registerAndLogin(owner, `list1${EMAIL_DOMAIN}`);
      await owner.post('/api/v1/schedules').send({
        name: 'Mine',
        jobType: 'API_REQUEST',
        cronExpression: '0 8 * * *',
        payload: { url: SAMPLE_URL },
      });

      const other = request.agent(app);
      await registerAndLogin(other, `list2${EMAIL_DOMAIN}`);
      const res = await other.get('/api/v1/schedules');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });
  });

  describe('PATCH /api/v1/schedules/:id', () => {
    it('disables a schedule', async () => {
      const agent = request.agent(app);
      await registerAndLogin(agent, `disable1${EMAIL_DOMAIN}`);
      const createRes = await agent.post('/api/v1/schedules').send({
        name: 'To disable',
        jobType: 'API_REQUEST',
        cronExpression: '0 8 * * *',
        payload: { url: SAMPLE_URL },
      });

      const res = await agent
        .patch(`/api/v1/schedules/${createRes.body.data.id}`)
        .send({ isActive: false });

      expect(res.status).toBe(200);
      expect(res.body.data.isActive).toBe(false);
    });

    it('recomputes nextRunAt when the cron expression changes', async () => {
      const agent = request.agent(app);
      await registerAndLogin(agent, `recompute1${EMAIL_DOMAIN}`);
      const createRes = await agent.post('/api/v1/schedules').send({
        name: 'Will change cadence',
        jobType: 'API_REQUEST',
        cronExpression: '0 8 * * *',
        payload: { url: SAMPLE_URL },
      });
      const originalNextRunAt = createRes.body.data.nextRunAt;

      const res = await agent
        .patch(`/api/v1/schedules/${createRes.body.data.id}`)
        .send({ cronExpression: '0 20 * * *' });

      expect(res.status).toBe(200);
      expect(res.body.data.nextRunAt).not.toBe(originalNextRunAt);
    });

    it("rejects updating another user's schedule", async () => {
      const owner = request.agent(app);
      await registerAndLogin(owner, `ownership1${EMAIL_DOMAIN}`);
      const createRes = await owner.post('/api/v1/schedules').send({
        name: 'Private',
        jobType: 'API_REQUEST',
        cronExpression: '0 8 * * *',
        payload: { url: SAMPLE_URL },
      });

      const intruder = request.agent(app);
      await registerAndLogin(intruder, `ownership2${EMAIL_DOMAIN}`);
      const res = await intruder
        .patch(`/api/v1/schedules/${createRes.body.data.id}`)
        .send({ isActive: false });

      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /api/v1/schedules/:id', () => {
    it('deletes a schedule', async () => {
      const agent = request.agent(app);
      await registerAndLogin(agent, `delete1${EMAIL_DOMAIN}`);
      const createRes = await agent.post('/api/v1/schedules').send({
        name: 'To delete',
        jobType: 'API_REQUEST',
        cronExpression: '0 8 * * *',
        payload: { url: SAMPLE_URL },
      });

      const res = await agent.delete(`/api/v1/schedules/${createRes.body.data.id}`);
      expect(res.status).toBe(200);

      const getRes = await agent.get(`/api/v1/schedules/${createRes.body.data.id}`);
      expect(getRes.status).toBe(404);
    });
  });

  describe('the scheduler actually triggering a due schedule', () => {
    it('creates a new Job, advances nextRunAt, and notifies the owner', async () => {
      const agent = request.agent(app);
      await registerAndLogin(agent, `trigger1${EMAIL_DOMAIN}`);
      const createRes = await agent.post('/api/v1/schedules').send({
        name: 'Due now',
        jobType: 'API_REQUEST',
        cronExpression: '0 8 * * *',
        payload: { url: SAMPLE_URL },
      });
      const scheduleId = createRes.body.data.id;

      // Force it into the past so this tick picks it up, rather than
      // waiting for node-cron's real per-minute timer or the cron
      // expression's actual next 8am occurrence.
      await prisma.schedule.update({
        where: { id: scheduleId },
        data: { nextRunAt: new Date(Date.now() - 60_000) },
      });

      await runDueSchedules();

      const updatedSchedule = await prisma.schedule.findUniqueOrThrow({ where: { id: scheduleId } });
      expect(updatedSchedule.lastRunAt).not.toBeNull();
      expect(updatedSchedule.nextRunAt!.getTime()).toBeGreaterThan(Date.now());

      const jobs = await prisma.job.findMany({ where: { name: 'Due now' } });
      expect(jobs).toHaveLength(1);
      expect(jobs[0].type).toBe('API_REQUEST');
      expect(jobs[0].status).toBe('QUEUED');

      const notifications = await prisma.notification.findMany({
        where: { type: 'SCHEDULE_TRIGGERED', jobId: jobs[0].id },
      });
      expect(notifications).toHaveLength(1);
    });

    it('does not trigger a disabled schedule even if it is technically due', async () => {
      const agent = request.agent(app);
      await registerAndLogin(agent, `trigger2${EMAIL_DOMAIN}`);
      const createRes = await agent.post('/api/v1/schedules').send({
        name: 'Due but disabled',
        jobType: 'API_REQUEST',
        cronExpression: '0 8 * * *',
        payload: { url: SAMPLE_URL },
      });
      const scheduleId = createRes.body.data.id;

      await prisma.schedule.update({
        where: { id: scheduleId },
        data: { nextRunAt: new Date(Date.now() - 60_000), isActive: false },
      });

      await runDueSchedules();

      const jobs = await prisma.job.findMany({ where: { name: 'Due but disabled' } });
      expect(jobs).toHaveLength(0);
    });
  });
});
