import { describe, expect, it, vi } from 'vitest';
import type { Redis } from 'ioredis';
import { createJobEventPublisher } from '../src/events/publish-job-event';
import { JOB_EVENTS_CHANNEL } from '../src/events/job-events';

describe('createJobEventPublisher', () => {
  it('publishes a JSON-serialized event, stamped with a timestamp, to the job events channel', async () => {
    const publish = vi.fn().mockResolvedValue(1);
    const mockConnection = { publish } as unknown as Redis;

    const publishJobEvent = createJobEventPublisher(mockConnection);
    await publishJobEvent({
      jobId: 'job-1',
      userId: 'user-1',
      type: 'job:completed',
      status: 'COMPLETED',
      progress: 100,
    });

    expect(publish).toHaveBeenCalledTimes(1);
    const [channel, message] = publish.mock.calls[0] as [string, string];
    expect(channel).toBe(JOB_EVENTS_CHANNEL);

    const parsed = JSON.parse(message);
    expect(parsed).toMatchObject({
      jobId: 'job-1',
      userId: 'user-1',
      type: 'job:completed',
      status: 'COMPLETED',
      progress: 100,
    });
    expect(typeof parsed.timestamp).toBe('string');
    expect(new Date(parsed.timestamp).toString()).not.toBe('Invalid Date');
  });

  it('propagates a publish failure to the caller (the caller decides whether to swallow it)', async () => {
    const publish = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const mockConnection = { publish } as unknown as Redis;

    const publishJobEvent = createJobEventPublisher(mockConnection);

    await expect(
      publishJobEvent({ jobId: 'job-1', userId: 'user-1', type: 'job:failed', status: 'FAILED' }),
    ).rejects.toThrow('ECONNREFUSED');
  });
});
