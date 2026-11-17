import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatDate, formatDuration, formatDurationFromDates, formatRelativeTime } from '../src/lib/format';

describe('formatDuration', () => {
  it.each([
    [0, '0ms'],
    [999, '999ms'],
    [1000, '1.0s'],
    [1500, '1.5s'],
    [59_999, '60.0s'],
    [60_000, '1m 0s'],
    [61_000, '1m 1s'],
    [125_000, '2m 5s'],
  ])('formats %i ms as %s', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });

  it('renders a dash for null and undefined (a job that has not finished has no duration)', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(undefined)).toBe('—');
  });
});

describe('formatDurationFromDates', () => {
  it('computes the elapsed time between two ISO timestamps', () => {
    expect(formatDurationFromDates('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:02.500Z')).toBe('2.5s');
  });

  it('renders a dash when either end is missing', () => {
    expect(formatDurationFromDates(null, '2026-01-01T00:00:00.000Z')).toBe('—');
    expect(formatDurationFromDates('2026-01-01T00:00:00.000Z', null)).toBe('—');
    expect(formatDurationFromDates(null, null)).toBe('—');
  });
});

describe('formatDate', () => {
  it('renders a dash for null, undefined, and empty values', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate(undefined)).toBe('—');
    expect(formatDate('')).toBe('—');
  });

  it('renders a real timestamp as a non-empty, non-dash string containing the year', () => {
    const result = formatDate('2026-06-15T12:00:00.000Z');
    expect(result).not.toBe('—');
    expect(result).toContain('2026');
  });
});

describe('formatRelativeTime', () => {
  afterEach(() => vi.useRealTimers());

  it('renders a dash for null and undefined', () => {
    expect(formatRelativeTime(null)).toBe('—');
    expect(formatRelativeTime(undefined)).toBe('—');
  });

  it('uses minutes for a near-future time, hours for a few hours out, and days beyond that', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    expect(formatRelativeTime('2026-01-01T00:05:00.000Z')).toMatch(/5 minutes/);
    expect(formatRelativeTime('2026-01-01T03:00:00.000Z')).toMatch(/3 hours/);
    expect(formatRelativeTime('2026-01-04T00:00:00.000Z')).toMatch(/3 days/);
  });

  it('renders past times with the same units', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T12:00:00.000Z'));

    expect(formatRelativeTime('2026-01-01T11:55:00.000Z')).toMatch(/5 minutes ago/);
  });
});
