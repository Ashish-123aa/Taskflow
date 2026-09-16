import { NonRetryableJobError } from '../../utils/errors';
import type { JobExecutionContext, JobHandler } from '../handler.types';

interface ApiRequestPayload {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
}

/**
 * The first handler implemented, deliberately: it's the job type the
 * spec's own end-to-end "Definition of Done" walkthrough (section 63)
 * uses to prove the whole pipeline — create → queue → worker → external
 * call → COMPLETED → dashboard update.
 *
 * SSRF protection (blocking localhost/private IPs/cloud metadata
 * endpoints, response size caps, redirect limits — section 57) is NOT
 * implemented yet. This is safe to use against the recommended free
 * public APIs (Open-Meteo, REST Countries, JSONPlaceholder) but is not
 * yet safe to expose to arbitrary user-supplied URLs — see
 * docs/security.md.
 */
export const apiRequestHandler: JobHandler = {
  async execute(ctx: JobExecutionContext) {
    const payload = ctx.payload as unknown as ApiRequestPayload;

    if (!payload?.url) {
      throw new NonRetryableJobError('API_REQUEST payload requires a "url"');
    }

    let url: URL;
    try {
      url = new URL(payload.url);
    } catch {
      throw new NonRetryableJobError(`"${payload.url}" is not a valid URL`);
    }

    await ctx.updateProgress(10);

    const start = Date.now();
    const response = await fetch(url, {
      method: payload.method ?? 'GET',
      headers: payload.headers,
      body: payload.body !== undefined ? JSON.stringify(payload.body) : undefined,
    });

    await ctx.updateProgress(70);

    const contentType = response.headers.get('content-type') ?? '';
    const responseBody = contentType.includes('application/json')
      ? await response.json()
      : await response.text();

    await ctx.updateProgress(100);

    // A non-2xx response from the target API is still a successful
    // TaskFlow job: the request completed and we captured exactly what
    // the target returned (section 16: "store status code, response,
    // duration, timestamp"). Only a request that never got a response at
    // all — a network failure or timeout, which `fetch` surfaces by
    // throwing — counts as a job failure here.
    return {
      statusCode: response.status,
      response: responseBody,
      durationMs: Date.now() - start,
      timestamp: new Date().toISOString(),
    };
  },
};
