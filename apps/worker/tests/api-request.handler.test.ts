import { afterEach, describe, expect, it, vi } from 'vitest';

// The handler now resolves every hostname through the SSRF guard before
// fetching (utils/ssrf-guard.ts) — mock DNS so these tests don't need
// real network access, and so "example.com" always resolves to a public
// (non-blocked) address regardless of the sandbox's actual DNS.
vi.mock('dns/promises', () => ({
  lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
}));

import { apiRequestHandler } from '../src/jobs/handlers/api-request.handler';
import { NonRetryableJobError } from '../src/utils/errors';

const noopProgress = async () => {};
const baseCtx = { jobId: '1', userId: 'u1', attempt: 1, updateProgress: noopProgress };

describe('apiRequestHandler', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('throws NonRetryableJobError when no url is provided', async () => {
    await expect(
      apiRequestHandler.execute({ ...baseCtx, payload: {} }),
    ).rejects.toThrow(NonRetryableJobError);
  });

  it('throws NonRetryableJobError for a malformed url', async () => {
    await expect(
      apiRequestHandler.execute({ ...baseCtx, payload: { url: 'not a url' } }),
    ).rejects.toThrow(NonRetryableJobError);
  });

  it('captures a successful JSON response', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ hello: 'world' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const result = await apiRequestHandler.execute({
      ...baseCtx,
      payload: { url: 'https://example.com/api' },
    });

    expect(result.statusCode).toBe(200);
    expect(result.response).toEqual({ hello: 'world' });
    expect(typeof result.durationMs).toBe('number');
  });

  it('treats a non-2xx response as a successful job, not a failure', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain' } }),
    ) as unknown as typeof fetch;

    const result = await apiRequestHandler.execute({
      ...baseCtx,
      payload: { url: 'https://example.com/missing' },
    });

    expect(result.statusCode).toBe(404);
    expect(result.response).toBe('Not Found');
  });

  it('lets a network failure propagate as a retryable error', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;

    await expect(
      apiRequestHandler.execute({ ...baseCtx, payload: { url: 'https://example.com/unreachable' } }),
    ).rejects.toThrow('ECONNREFUSED');
  });

  it('reports progress at each stage', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    ) as unknown as typeof fetch;

    const progressUpdates: number[] = [];
    await apiRequestHandler.execute({
      jobId: '1',
      userId: 'u1',
      attempt: 1,
      payload: { url: 'https://example.com/api' },
      updateProgress: async (percent) => {
        progressUpdates.push(percent);
      },
    });

    expect(progressUpdates).toEqual([10, 70, 100]);
  });

  // ── Phase 9.1: SSRF protection ─────────────────────────────────────────

  it('blocks a request to localhost', async () => {
    global.fetch = vi.fn();
    await expect(
      apiRequestHandler.execute({ ...baseCtx, payload: { url: 'http://localhost:4000/admin' } }),
    ).rejects.toThrow(NonRetryableJobError);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('blocks a request to a private IP literal', async () => {
    global.fetch = vi.fn();
    await expect(
      apiRequestHandler.execute({ ...baseCtx, payload: { url: 'http://10.0.0.5/internal' } }),
    ).rejects.toThrow(NonRetryableJobError);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('blocks a request to the cloud metadata address', async () => {
    global.fetch = vi.fn();
    await expect(
      apiRequestHandler.execute({
        ...baseCtx,
        payload: { url: 'http://169.254.169.254/latest/meta-data/' },
      }),
    ).rejects.toThrow(NonRetryableJobError);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects a non-http(s) protocol before ever calling fetch', async () => {
    global.fetch = vi.fn();
    await expect(
      apiRequestHandler.execute({ ...baseCtx, payload: { url: 'file:///etc/passwd' } }),
    ).rejects.toThrow(NonRetryableJobError);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
