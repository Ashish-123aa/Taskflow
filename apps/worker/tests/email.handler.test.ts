import nodemailer from 'nodemailer';
import { describe, expect, it } from 'vitest';
import { createEmailHandler } from '../src/jobs/handlers/email.handler';
import { NonRetryableJobError } from '../src/utils/errors';

const noopProgress = async () => {};
const baseCtx = { jobId: '1', userId: 'u1', attempt: 1, updateProgress: noopProgress };

// jsonTransport never opens a network connection — it validates the
// message and returns it back as JSON, which is exactly what's needed to
// test the handler's own logic without a real SMTP server.
function testHandler() {
  return createEmailHandler(nodemailer.createTransport({ jsonTransport: true }));
}

describe('emailHandler', () => {
  it('rejects an invalid recipient address without sending', async () => {
    const handler = testHandler();
    await expect(
      handler.execute({
        ...baseCtx,
        payload: { to: 'not-an-email', subject: 'Hi', body: 'hello' },
      }),
    ).rejects.toThrow(NonRetryableJobError);
  });

  it('rejects a missing subject', async () => {
    const handler = testHandler();
    await expect(
      handler.execute({ ...baseCtx, payload: { to: 'a@example.com', body: 'hello' } }),
    ).rejects.toThrow(NonRetryableJobError);
  });

  it('sends a well-formed message and returns delivery metadata', async () => {
    const handler = testHandler();
    const result = await handler.execute({
      ...baseCtx,
      payload: { to: 'ada@example.com', subject: 'Job complete', body: 'Your report is ready.' },
    });

    expect(result.messageId).toBeTruthy();
    // jsonTransport (used here to avoid any real network call) doesn't
    // populate accepted/rejected the way a real SMTP connection does —
    // it does populate the envelope, which is what's checked instead.
    expect((result.envelope as { to: string[] }).to).toEqual(['ada@example.com']);
    expect(typeof result.timestamp).toBe('string');
  });

  it('reports progress before and after sending', async () => {
    const handler = testHandler();
    const progressUpdates: number[] = [];
    await handler.execute({
      jobId: '1',
      userId: 'u1',
      attempt: 1,
      updateProgress: async (p) => {
        progressUpdates.push(p);
      },
      payload: { to: 'ada@example.com', subject: 'Hi', body: 'hello' },
    });

    expect(progressUpdates).toEqual([20, 100]);
  });
});
