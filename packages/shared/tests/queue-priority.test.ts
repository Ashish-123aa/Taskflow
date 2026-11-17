import { describe, expect, it } from 'vitest';
import { toBullMQPriority } from '../src/queue/priority';

describe('toBullMQPriority', () => {
  // TaskFlow's own priorities read LOW < MEDIUM < HIGH < CRITICAL (higher
  // word, runs first); BullMQ's own convention is the opposite (a LOWER
  // number runs first) — see docs/queue-system.md ("Priority mapping").
  // This locks in the inversion so it can never silently flip.
  it('maps CRITICAL to the lowest BullMQ number (processed first)', () => {
    expect(toBullMQPriority('CRITICAL')).toBe(1);
  });

  it('maps HIGH below MEDIUM below LOW, in strictly increasing BullMQ numbers', () => {
    const critical = toBullMQPriority('CRITICAL');
    const high = toBullMQPriority('HIGH');
    const medium = toBullMQPriority('MEDIUM');
    const low = toBullMQPriority('LOW');

    expect(critical).toBeLessThan(high);
    expect(high).toBeLessThan(medium);
    expect(medium).toBeLessThan(low);
  });

  it('maps every priority to a distinct number', () => {
    const values = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((p) => toBullMQPriority(p as never));
    expect(new Set(values).size).toBe(4);
  });
});
