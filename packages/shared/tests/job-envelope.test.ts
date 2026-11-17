import { describe, expect, it } from 'vitest';
import { createJobSchema, retryJobSchema } from '../src/schemas/job';

describe('createJobSchema', () => {
  const validInput = {
    name: 'Fetch weather',
    type: 'API_REQUEST',
    payload: { url: 'https://example.com' },
  };

  it('accepts a minimal valid job', () => {
    const result = createJobSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it('defaults priority to MEDIUM when omitted', () => {
    const result = createJobSchema.parse(validInput);
    expect(result.priority).toBe('MEDIUM');
  });

  it('accepts every declared job type', () => {
    for (const type of [
      'CSV_PROCESSING',
      'API_REQUEST',
      'EMAIL',
      'REPORT_GENERATION',
      'IMAGE_PROCESSING',
      'SCHEDULED_API_FETCH',
      'DATA_TRANSFORMATION',
    ]) {
      expect(createJobSchema.safeParse({ ...validInput, type }).success).toBe(true);
    }
  });

  it('rejects an unknown job type', () => {
    const result = createJobSchema.safeParse({ ...validInput, type: 'NOT_A_REAL_TYPE' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing name', () => {
    expect(createJobSchema.safeParse({ type: validInput.type, payload: validInput.payload }).success).toBe(
      false,
    );
  });

  it('rejects an empty-string name', () => {
    expect(createJobSchema.safeParse({ ...validInput, name: '' }).success).toBe(false);
  });

  it('rejects a name over 200 characters', () => {
    expect(createJobSchema.safeParse({ ...validInput, name: 'x'.repeat(201) }).success).toBe(false);
  });

  it('rejects a missing payload', () => {
    expect(createJobSchema.safeParse({ name: validInput.name, type: validInput.type }).success).toBe(
      false,
    );
  });

  it.each([0, 11, -1, 1.5])('rejects maxAttempts of %s (outside 1-10 or non-integer)', (maxAttempts) => {
    expect(createJobSchema.safeParse({ ...validInput, maxAttempts }).success).toBe(false);
  });

  it.each([1, 5, 10])('accepts maxAttempts of %s', (maxAttempts) => {
    expect(createJobSchema.safeParse({ ...validInput, maxAttempts }).success).toBe(true);
  });

  it('coerces a maxAttempts sent as a numeric string (multipart/query values arrive as strings)', () => {
    const result = createJobSchema.parse({ ...validInput, maxAttempts: '5' });
    expect(result.maxAttempts).toBe(5);
  });

  it('coerces a scheduledAt string into a real Date', () => {
    const result = createJobSchema.parse({ ...validInput, scheduledAt: '2026-06-01T08:00:00.000Z' });
    expect(result.scheduledAt).toBeInstanceOf(Date);
  });

  it('rejects an unparseable scheduledAt', () => {
    expect(createJobSchema.safeParse({ ...validInput, scheduledAt: 'not-a-date' }).success).toBe(false);
  });
});

describe('retryJobSchema', () => {
  it('accepts an empty object — the whole body is optional', () => {
    expect(retryJobSchema.safeParse({}).success).toBe(true);
  });

  it('accepts a valid maxAttempts override', () => {
    const result = retryJobSchema.parse({ maxAttempts: 8 });
    expect(result.maxAttempts).toBe(8);
  });

  it.each([0, 11])('rejects maxAttempts of %s', (maxAttempts) => {
    expect(retryJobSchema.safeParse({ maxAttempts }).success).toBe(false);
  });
});
