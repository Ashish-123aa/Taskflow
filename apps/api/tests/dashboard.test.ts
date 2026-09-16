import { afterAll, afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '@taskflow/shared';
import { createApp } from '../src/app';

const app = createApp();
const EMAIL_DOMAIN = '@test.taskflow.local';

describe('Dashboard', () => {
  afterEach(async () => {
    await prisma.job.deleteMany({ where: { user: { email: { endsWith: EMAIL_DOMAIN } } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: EMAIL_DOMAIN } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('rejects an unauthenticated request', async () => {
    const res = await request(app).get('/api/v1/dashboard/stats');
    expect(res.status).toBe(401);
  });

  it('returns zeroed stats for a brand new user with no jobs', async () => {
    const agent = request.agent(app);
    await agent
      .post('/api/v1/auth/register')
      .send({ name: 'Dash Test', email: `dash1${EMAIL_DOMAIN}`, password: 'Password123' });

    const res = await agent.get('/api/v1/dashboard/stats');
    expect(res.status).toBe(200);
    expect(res.body.data.totalJobs).toBe(0);
    expect(res.body.data.successRate).toBe(0);
    expect(res.body.data.jobsOverTime).toHaveLength(14);
  });

  it("only counts the requesting user's own jobs", async () => {
    const agent = request.agent(app);
    await agent
      .post('/api/v1/auth/register')
      .send({ name: 'Dash Test 2', email: `dash2${EMAIL_DOMAIN}`, password: 'Password123' });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: `dash2${EMAIL_DOMAIN}` } });

    await prisma.job.create({
      data: {
        userId: user.id,
        type: 'API_REQUEST',
        name: 'Completed one',
        status: 'COMPLETED',
        payload: { url: 'https://example.com' },
        startedAt: new Date(Date.now() - 5000),
        completedAt: new Date(),
      },
    });

    const otherUser = await prisma.user.create({
      data: { name: 'Other', email: `dashother2${EMAIL_DOMAIN}`, passwordHash: 'irrelevant' },
    });
    await prisma.job.create({
      data: {
        userId: otherUser.id,
        type: 'API_REQUEST',
        name: "Someone else's job",
        status: 'COMPLETED',
        payload: { url: 'https://example.com' },
      },
    });

    const res = await agent.get('/api/v1/dashboard/stats');
    expect(res.body.data.totalJobs).toBe(1);
    expect(res.body.data.completedJobs).toBe(1);
    expect(res.body.data.successRate).toBe(100);
    expect(res.body.data.avgProcessingTimeMs).toBeGreaterThan(0);

    await prisma.job.deleteMany({ where: { userId: otherUser.id } });
    await prisma.user.delete({ where: { id: otherUser.id } });
  });
});
