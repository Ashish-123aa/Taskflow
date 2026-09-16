import { afterAll, afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '@taskflow/shared';
import { createApp } from '../src/app';
import { jobQueue } from '../src/queues/job.queue';

const app = createApp();
const EMAIL_DOMAIN = '@test.taskflow.local';
const SAMPLE_URL = 'https://api.open-meteo.com/v1/forecast?latitude=0&longitude=0&current_weather=true';

async function registerAndLogin(agent: ReturnType<typeof request.agent>, email: string) {
  await agent
    .post('/api/v1/auth/register')
    .send({ name: 'Job Test User', email, password: 'Password123' });
}

describe('Jobs', () => {
  afterEach(async () => {
    await prisma.job.deleteMany({ where: { user: { email: { endsWith: EMAIL_DOMAIN } } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: EMAIL_DOMAIN } } });
  });

  afterAll(async () => {
    await jobQueue.close();
    await prisma.$disconnect();
  });

  it('rejects job creation without authentication', async () => {
    const res = await request(app)
      .post('/api/v1/jobs')
      .send({ name: 'Unauthorized job', type: 'API_REQUEST', payload: { url: SAMPLE_URL } });

    expect(res.status).toBe(401);
  });

  it('creates a job, persists it as QUEUED, and returns it to its owner', async () => {
    const agent = request.agent(app);
    await registerAndLogin(agent, `owner${EMAIL_DOMAIN}`);

    const createRes = await agent.post('/api/v1/jobs').send({
      name: 'Fetch weather',
      type: 'API_REQUEST',
      priority: 'HIGH',
      payload: { url: SAMPLE_URL },
    });

    expect(createRes.status).toBe(201);
    expect(createRes.body.data.status).toBe('QUEUED');
    expect(createRes.body.data.type).toBe('API_REQUEST');

    const jobId = createRes.body.data.id;
    const getRes = await agent.get(`/api/v1/jobs/${jobId}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.id).toBe(jobId);
  });

  it('rejects an unknown job type', async () => {
    const agent = request.agent(app);
    await registerAndLogin(agent, `badtype${EMAIL_DOMAIN}`);

    const res = await agent
      .post('/api/v1/jobs')
      .send({ name: 'Bad job', type: 'NOT_A_REAL_TYPE', payload: {} });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');
  });

  it("prevents one user from viewing another user's job", async () => {
    const owner = request.agent(app);
    await registerAndLogin(owner, `owner2${EMAIL_DOMAIN}`);
    const createRes = await owner
      .post('/api/v1/jobs')
      .send({ name: 'Private job', type: 'API_REQUEST', payload: { url: SAMPLE_URL } });
    const jobId = createRes.body.data.id;

    const intruder = request.agent(app);
    await registerAndLogin(intruder, `intruder${EMAIL_DOMAIN}`);
    const res = await intruder.get(`/api/v1/jobs/${jobId}`);

    expect(res.status).toBe(403);
  });

  it('lists only the requesting user\u2019s own jobs, paginated', async () => {
    const agent = request.agent(app);
    await registerAndLogin(agent, `lister${EMAIL_DOMAIN}`);

    for (let i = 0; i < 3; i += 1) {
      await agent
        .post('/api/v1/jobs')
        .send({ name: `Job ${i}`, type: 'API_REQUEST', payload: { url: SAMPLE_URL } });
    }

    const res = await agent.get('/api/v1/jobs').query({ page: 1, limit: 2 });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination.total).toBe(3);
    expect(res.body.pagination.totalPages).toBe(2);
  });

  it('cancels a queued job', async () => {
    const agent = request.agent(app);
    await registerAndLogin(agent, `canceller${EMAIL_DOMAIN}`);
    const createRes = await agent
      .post('/api/v1/jobs')
      .send({ name: 'To be cancelled', type: 'API_REQUEST', payload: { url: SAMPLE_URL } });
    const jobId = createRes.body.data.id;

    const cancelRes = await agent.post(`/api/v1/jobs/${jobId}/cancel`);
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.data.status).toBe('CANCELLED');
  });

  it('refuses to retry a job that is not in a retryable state', async () => {
    const agent = request.agent(app);
    await registerAndLogin(agent, `retryer${EMAIL_DOMAIN}`);
    const createRes = await agent
      .post('/api/v1/jobs')
      .send({ name: 'Freshly queued', type: 'API_REQUEST', payload: { url: SAMPLE_URL } });
    const jobId = createRes.body.data.id;

    // A freshly QUEUED job hasn't failed yet, so it isn't retryable.
    const retryRes = await agent.post(`/api/v1/jobs/${jobId}/retry`);
    expect(retryRes.status).toBe(409);
    expect(retryRes.body.errorCode).toBe('CONFLICT');
  });

  it('refuses to delete a job that is still queued', async () => {
    const agent = request.agent(app);
    await registerAndLogin(agent, `deleter${EMAIL_DOMAIN}`);
    const createRes = await agent
      .post('/api/v1/jobs')
      .send({ name: 'Still queued', type: 'API_REQUEST', payload: { url: SAMPLE_URL } });
    const jobId = createRes.body.data.id;

    const deleteRes = await agent.delete(`/api/v1/jobs/${jobId}`);
    expect(deleteRes.status).toBe(409);
  });

  it('accepts a custom maxAttempts at creation time, within bounds', async () => {
    const agent = request.agent(app);
    await registerAndLogin(agent, `maxattempts${EMAIL_DOMAIN}`);

    const res = await agent.post('/api/v1/jobs').send({
      name: 'Custom retry budget',
      type: 'API_REQUEST',
      payload: { url: SAMPLE_URL },
      maxAttempts: 7,
    });

    expect(res.status).toBe(201);
    expect(res.body.data.maxAttempts).toBe(7);
  });

  it('rejects a maxAttempts outside the allowed 1-10 range', async () => {
    const agent = request.agent(app);
    await registerAndLogin(agent, `maxattemptsbad${EMAIL_DOMAIN}`);

    const res = await agent.post('/api/v1/jobs').send({
      name: 'Too many retries',
      type: 'API_REQUEST',
      payload: { url: SAMPLE_URL },
      maxAttempts: 50,
    });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');
  });

  it('lets a manual retry override maxAttempts for a fresh cycle', async () => {
    const agent = request.agent(app);
    await registerAndLogin(agent, `retryoverride${EMAIL_DOMAIN}`);

    const createRes = await agent
      .post('/api/v1/jobs')
      .send({ name: 'Will fail then retry', type: 'API_REQUEST', payload: { url: SAMPLE_URL } });
    const jobId = createRes.body.data.id;

    // Force it into a retryable state directly — actually exhausting a
    // real retry cycle needs a running worker, which this suite doesn't
    // have; the point here is testing the API layer's own logic, not
    // re-proving worker behavior already covered by the worker's own
    // tests.
    await prisma.job.update({ where: { id: jobId }, data: { status: 'DEAD_LETTER', attempts: 3 } });

    const retryRes = await agent.post(`/api/v1/jobs/${jobId}/retry`).send({ maxAttempts: 8 });
    expect(retryRes.status).toBe(200);
    expect(retryRes.body.data.status).toBe('QUEUED');
    expect(retryRes.body.data.maxAttempts).toBe(8);
  });
});
