import { afterAll, afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '@taskflow/shared';
import { createApp } from '../src/app';

const app = createApp();
const EMAIL_DOMAIN = '@test.taskflow.local';

async function registerAndLogin(agent: ReturnType<typeof request.agent>, email: string) {
  await agent
    .post('/api/v1/auth/register')
    .send({ name: 'Notification Test User', email, password: 'Password123' });
}

describe('Notifications', () => {
  afterEach(async () => {
    await prisma.notification.deleteMany({ where: { user: { email: { endsWith: EMAIL_DOMAIN } } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: EMAIL_DOMAIN } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('rejects an unauthenticated request', async () => {
    const res = await request(app).get('/api/v1/notifications');
    expect(res.status).toBe(401);
  });

  it('lists only the requesting user\u2019s own notifications, with an unread count', async () => {
    const agent = request.agent(app);
    await registerAndLogin(agent, `notif1${EMAIL_DOMAIN}`);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: `notif1${EMAIL_DOMAIN}` } });

    // Notifications are only ever created by the worker in real usage
    // (see apps/worker/src/repositories/notification.repository.ts) —
    // this test creates them directly via Prisma to set up state, the
    // same pattern jobs.test.ts uses to force a job into DEAD_LETTER.
    await prisma.notification.createMany({
      data: [
        { userId: user.id, type: 'JOB_COMPLETED', message: 'Job A completed.' },
        { userId: user.id, type: 'JOB_FAILED', message: 'Job B failed.', isRead: true },
      ],
    });

    const res = await agent.get('/api/v1/notifications');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.unreadCount).toBe(1);
  });

  it('does not include another user\u2019s notifications', async () => {
    const agent = request.agent(app);
    await registerAndLogin(agent, `notif2${EMAIL_DOMAIN}`);

    const otherUser = await prisma.user.create({
      data: {
        name: 'Other',
        email: `notifother2${EMAIL_DOMAIN}`,
        passwordHash: 'irrelevant-for-this-test',
      },
    });
    await prisma.notification.create({
      data: { userId: otherUser.id, type: 'JOB_COMPLETED', message: 'Not yours.' },
    });

    const res = await agent.get('/api/v1/notifications');
    expect(res.body.data).toHaveLength(0);

    await prisma.user.delete({ where: { id: otherUser.id } });
  });

  it('filters to unread only when requested', async () => {
    const agent = request.agent(app);
    await registerAndLogin(agent, `notif3${EMAIL_DOMAIN}`);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: `notif3${EMAIL_DOMAIN}` } });

    await prisma.notification.createMany({
      data: [
        { userId: user.id, type: 'JOB_COMPLETED', message: 'Read one.', isRead: true },
        { userId: user.id, type: 'JOB_FAILED', message: 'Unread one.' },
      ],
    });

    const res = await agent.get('/api/v1/notifications').query({ unreadOnly: 'true' });
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].message).toBe('Unread one.');
  });

  describe('PATCH /api/v1/notifications/:id/read', () => {
    it("marks the caller's own notification as read", async () => {
      const agent = request.agent(app);
      await registerAndLogin(agent, `notif4${EMAIL_DOMAIN}`);
      const user = await prisma.user.findUniqueOrThrow({ where: { email: `notif4${EMAIL_DOMAIN}` } });
      const notification = await prisma.notification.create({
        data: { userId: user.id, type: 'JOB_COMPLETED', message: 'Mark me read.' },
      });

      const res = await agent.patch(`/api/v1/notifications/${notification.id}/read`);
      expect(res.status).toBe(200);
      expect(res.body.data.isRead).toBe(true);
    });

    it("rejects marking another user's notification as read", async () => {
      const agent = request.agent(app);
      await registerAndLogin(agent, `notif5${EMAIL_DOMAIN}`);

      const otherUser = await prisma.user.create({
        data: { name: 'Other', email: `notifother5${EMAIL_DOMAIN}`, passwordHash: 'irrelevant' },
      });
      const notification = await prisma.notification.create({
        data: { userId: otherUser.id, type: 'JOB_COMPLETED', message: 'Not yours.' },
      });

      const res = await agent.patch(`/api/v1/notifications/${notification.id}/read`);
      expect(res.status).toBe(403);

      await prisma.user.delete({ where: { id: otherUser.id } });
    });

    it('returns 404 for a nonexistent notification', async () => {
      const agent = request.agent(app);
      await registerAndLogin(agent, `notif6${EMAIL_DOMAIN}`);

      const res = await agent.patch('/api/v1/notifications/00000000-0000-0000-0000-000000000000/read');
      expect(res.status).toBe(404);
    });
  });
});
