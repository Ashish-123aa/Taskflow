import { describe, expect, it } from 'vitest';
import { apiRequestPayloadSchema } from '../src/schemas/job-payloads';

describe('apiRequestPayloadSchema', () => {
  it('accepts a well-formed https URL', () => {
    const result = apiRequestPayloadSchema.safeParse({ url: 'https://api.open-meteo.com/v1/forecast' });
    expect(result.success).toBe(true);
  });

  it('accepts a well-formed http URL', () => {
    const result = apiRequestPayloadSchema.safeParse({ url: 'http://example.com/data' });
    expect(result.success).toBe(true);
  });

  it('rejects a non-http(s) protocol', () => {
    const result = apiRequestPayloadSchema.safeParse({ url: 'ftp://example.com/file.csv' });
    expect(result.success).toBe(false);
  });

  it('rejects the file:// protocol', () => {
    const result = apiRequestPayloadSchema.safeParse({ url: 'file:///etc/passwd' });
    expect(result.success).toBe(false);
  });

  it('rejects a malformed URL', () => {
    const result = apiRequestPayloadSchema.safeParse({ url: 'not a url' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing url field', () => {
    const result = apiRequestPayloadSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  // Note: this schema deliberately does NOT reject localhost or private
  // IPs — that check needs a DNS lookup, which isn't trustworthy at
  // job-creation time (the same hostname can resolve differently by the
  // time the job actually runs). That check is the worker's job, right
  // before it makes the request — see
  // apps/worker/src/utils/ssrf-guard.ts.
  it('still accepts a localhost URL at the schema level (blocked later, by the worker)', () => {
    const result = apiRequestPayloadSchema.safeParse({ url: 'http://localhost:4000/admin' });
    expect(result.success).toBe(true);
  });
});
