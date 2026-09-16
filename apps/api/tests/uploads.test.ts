import { afterAll, afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '@taskflow/shared';
import { createApp } from '../src/app';
import { jobQueue } from '../src/queues/job.queue';

const app = createApp();
const EMAIL_DOMAIN = '@test.taskflow.local';

async function registerAndLogin(agent: ReturnType<typeof request.agent>, email: string) {
  await agent
    .post('/api/v1/auth/register')
    .send({ name: 'Upload Test User', email, password: 'Password123' });
}

describe('Uploads', () => {
  afterEach(async () => {
    await prisma.job.deleteMany({ where: { user: { email: { endsWith: EMAIL_DOMAIN } } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: EMAIL_DOMAIN } } });
  });

  afterAll(async () => {
    await jobQueue.close();
    await prisma.$disconnect();
  });

  describe('POST /api/v1/jobs/upload/csv', () => {
    it('rejects a non-CSV file', async () => {
      const agent = request.agent(app);
      await registerAndLogin(agent, `csvreject${EMAIL_DOMAIN}`);

      const res = await agent
        .post('/api/v1/jobs/upload/csv')
        .attach('file', Buffer.from('not a csv'), { filename: 'notes.txt', contentType: 'text/plain' });

      expect(res.status).toBe(400);
    });

    it('accepts a CSV file and creates a CSV_PROCESSING job', async () => {
      const agent = request.agent(app);
      await registerAndLogin(agent, `csvaccept${EMAIL_DOMAIN}`);

      const csvContent = 'name,age\nAda,30\nAlan,28\n';
      const res = await agent
        .post('/api/v1/jobs/upload/csv')
        .field('name', 'My CSV job')
        .attach('file', Buffer.from(csvContent), { filename: 'people.csv', contentType: 'text/csv' });

      expect(res.status).toBe(201);
      expect(res.body.data.type).toBe('CSV_PROCESSING');
      expect(res.body.data.status).toBe('QUEUED');
      expect(res.body.data.payload.originalFilename).toBe('people.csv');
      // The stored filename must never equal the client-supplied one —
      // that's the actual path-traversal defense (section 35).
      expect(res.body.data.payload.storedFilename).not.toBe('people.csv');
    });
  });

  describe('POST /api/v1/jobs/upload/image', () => {
    it('rejects a non-image file', async () => {
      const agent = request.agent(app);
      await registerAndLogin(agent, `imgreject${EMAIL_DOMAIN}`);

      const res = await agent
        .post('/api/v1/jobs/upload/image')
        .attach('file', Buffer.from('not an image'), { filename: 'fake.jpg', contentType: 'text/plain' });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/v1/jobs/:id/download', () => {
    it('returns 404 for a job with no downloadable result yet', async () => {
      const agent = request.agent(app);
      await registerAndLogin(agent, `download${EMAIL_DOMAIN}`);

      const createRes = await agent.post('/api/v1/jobs').send({
        name: 'Not finished yet',
        type: 'API_REQUEST',
        payload: { url: 'https://api.open-meteo.com/v1/forecast?latitude=0&longitude=0' },
      });

      const res = await agent.get(`/api/v1/jobs/${createRes.body.data.id}/download`);
      expect(res.status).toBe(404);
    });
  });
});
