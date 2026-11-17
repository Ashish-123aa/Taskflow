import { describe, expect, it } from 'vitest';
import { createScheduleSchema, updateScheduleSchema } from '../src/schemas/schedule';

describe('createScheduleSchema', () => {
  const validInput = {
    name: 'Daily weather report',
    jobType: 'API_REQUEST',
    payload: { url: 'https://example.com' },
    cronExpression: '0 8 * * *',
  };

  it('accepts a minimal valid schedule', () => {
    expect(createScheduleSchema.safeParse(validInput).success).toBe(true);
  });

  it('defaults priority to MEDIUM when omitted', () => {
    expect(createScheduleSchema.parse(validInput).priority).toBe('MEDIUM');
  });

  it('rejects an invalid cron expression', () => {
    const result = createScheduleSchema.safeParse({ ...validInput, cronExpression: 'not-a-cron' });
    expect(result.success).toBe(false);
  });

  it('rejects an empty cron expression', () => {
    expect(createScheduleSchema.safeParse({ ...validInput, cronExpression: '' }).success).toBe(false);
  });

  it('accepts a cron expression using step/range syntax', () => {
    expect(
      createScheduleSchema.safeParse({ ...validInput, cronExpression: '*/15 9-17 * * 1-5' }).success,
    ).toBe(true);
  });

  it('rejects an unknown jobType', () => {
    expect(createScheduleSchema.safeParse({ ...validInput, jobType: 'NOT_A_REAL_TYPE' }).success).toBe(
      false,
    );
  });

  it('rejects a missing name', () => {
    expect(
      createScheduleSchema.safeParse({
        jobType: validInput.jobType,
        payload: validInput.payload,
        cronExpression: validInput.cronExpression,
      }).success,
    ).toBe(false);
  });

  it.each([0, 11])('rejects maxAttempts of %s', (maxAttempts) => {
    expect(createScheduleSchema.safeParse({ ...validInput, maxAttempts }).success).toBe(false);
  });
});

describe('updateScheduleSchema', () => {
  it('accepts a completely empty object — every field is a partial update', () => {
    expect(updateScheduleSchema.safeParse({}).success).toBe(true);
  });

  it('accepts updating just isActive', () => {
    expect(updateScheduleSchema.safeParse({ isActive: false }).success).toBe(true);
  });

  it('validates cronExpression exactly as strictly as creation does, when provided', () => {
    expect(updateScheduleSchema.safeParse({ cronExpression: 'garbage' }).success).toBe(false);
    expect(updateScheduleSchema.safeParse({ cronExpression: '0 20 * * *' }).success).toBe(true);
  });

  it('has no jobType field at all — the type cannot be changed after creation', () => {
    // Passing an unrecognized extra key is simply ignored by a plain
    // z.object() (not .strict()), so this asserts the schema's own
    // shape rather than runtime rejection — see docs/scheduling.md for
    // why jobType is intentionally not one of updateScheduleSchema's
    // fields.
    expect('jobType' in updateScheduleSchema.shape).toBe(false);
  });

  it.each([0, 11])('rejects maxAttempts of %s when provided', (maxAttempts) => {
    expect(updateScheduleSchema.safeParse({ maxAttempts }).success).toBe(false);
  });

  it('rejects an empty-string name when provided (but omitting name entirely is fine)', () => {
    expect(updateScheduleSchema.safeParse({ name: '' }).success).toBe(false);
    expect(updateScheduleSchema.safeParse({}).success).toBe(true);
  });
});
