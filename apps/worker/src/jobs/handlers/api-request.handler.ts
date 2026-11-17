import { NonRetryableJobError } from '../../utils/errors';
import { safeFetch } from '../../utils/ssrf-guard';
import { env } from '../../config/env';
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
 * As of Phase 9, every outbound call goes through `safeFetch`
 * (utils/ssrf-guard.ts) instead of the bare global `fetch`: it blocks
 * localhost/private/link-local/reserved addresses (including the
 * 169.254.169.254 cloud-metadata address), only allows http/https,
 * re-validates every redirect hop by hand rather than letting `fetch`
 * auto-follow, and enforces both a request timeout and a response-size
 * cap (`EXTERNAL_REQUEST_TIMEOUT_MS` / `EXTERNAL_MAX_RESPONSE_SIZE_MB`).
 * See docs/security.md for the full reasoning and the one limitation
 * that guard documents rather than silently ignores (no IP-pinning
 * against DNS rebinding).
 */
export const apiRequestHandler: JobHandler = {
  async execute(ctx: JobExecutionContext) {
    const payload = ctx.payload as unknown as ApiRequestPayload;

    if (!payload?.url) {
      throw new NonRetryableJobError('API_REQUEST payload requires a "url"');
    }

    await ctx.updateProgress(10);

    const start = Date.now();
    const { response, body: rawBody } = await safeFetch(payload.url, {
      method: payload.method ?? 'GET',
      headers: payload.headers,
      body: payload.body !== undefined ? JSON.stringify(payload.body) : undefined,
      timeoutMs: env.EXTERNAL_REQUEST_TIMEOUT_MS,
      maxResponseBytes: env.EXTERNAL_MAX_RESPONSE_SIZE_MB * 1024 * 1024,
    });

    await ctx.updateProgress(70);

    const contentType = response.headers.get('content-type') ?? '';
    let responseBody: unknown = rawBody;
    if (contentType.includes('application/json')) {
      try {
        responseBody = rawBody.length > 0 ? JSON.parse(rawBody) : null;
      } catch {
        // The server claimed JSON in its Content-Type but didn't send
        // valid JSON — fall back to the raw text rather than failing the
        // whole job over a header/body mismatch that isn't TaskFlow's.
        responseBody = rawBody;
      }
    }

    await ctx.updateProgress(100);

    // A non-2xx response from the target API is still a successful
    // TaskFlow job: the request completed and we captured exactly what
    // the target returned (section 16: "store status code, response,
    // duration, timestamp"). Only a request that never got a response at
    // all — a network failure, a timeout, or one refused outright by the
    // SSRF guard above — counts as a job failure here.
    return {
      statusCode: response.status,
      response: responseBody,
      durationMs: Date.now() - start,
      timestamp: new Date().toISOString(),
    };
  },
};
