import { describe, expect, it } from 'vitest';
import { formatJobSummaryCsv } from '../src/jobs/handlers/report-format';

describe('formatJobSummaryCsv', () => {
  it('produces a header row followed by one line per status', () => {
    const csv = formatJobSummaryCsv([
      { status: 'COMPLETED', count: 12 },
      { status: 'FAILED', count: 2 },
    ]);

    expect(csv).toBe('status,count\nCOMPLETED,12\nFAILED,2');
  });

  it('produces just the header when there are no jobs', () => {
    expect(formatJobSummaryCsv([])).toBe('status,count');
  });
});
