import { describe, expect, it } from 'vitest';
import { getNextRunDate, isValidCronExpression } from '../src/scheduling/cron';

describe('getNextRunDate', () => {
  it('computes the next occurrence of a daily cron expression', () => {
    const from = new Date('2026-01-01T00:00:00.000Z');
    const next = getNextRunDate('0 8 * * *', from);
    expect(next.toISOString()).toBe('2026-01-01T08:00:00.000Z');
  });

  it('rolls over to the next day when the reference time is past the trigger time', () => {
    const from = new Date('2026-01-01T09:00:00.000Z');
    const next = getNextRunDate('0 8 * * *', from);
    expect(next.toISOString()).toBe('2026-01-02T08:00:00.000Z');
  });

  it('defaults the reference time to now when not provided', () => {
    const next = getNextRunDate('0 8 * * *');
    expect(next.getTime()).toBeGreaterThan(Date.now());
  });

  it('throws for an invalid cron expression', () => {
    expect(() => getNextRunDate('not-a-cron')).toThrow();
  });
});

describe('isValidCronExpression', () => {
  it('accepts a valid expression', () => {
    expect(isValidCronExpression('0 8 * * *')).toBe(true);
  });

  it('accepts an expression with step/range syntax', () => {
    expect(isValidCronExpression('*/15 9-17 * * 1-5')).toBe(true);
  });

  it('rejects nonsense input', () => {
    expect(isValidCronExpression('not-a-cron')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isValidCronExpression('')).toBe(false);
  });
});
