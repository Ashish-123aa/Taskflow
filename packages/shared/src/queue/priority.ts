import type { JobPriority } from '../constants/job-types';

/**
 * TaskFlow's domain priorities read LOW < MEDIUM < HIGH < CRITICAL — higher
 * word, runs first, intuitively. BullMQ's own `priority` option is the
 * opposite: a LOWER number is processed first. This is the one place that
 * inversion is handled, so nothing else in the codebase has to remember
 * BullMQ's convention when enqueuing a job.
 */
const PRIORITY_TO_BULLMQ: Record<JobPriority, number> = {
  CRITICAL: 1,
  HIGH: 2,
  MEDIUM: 3,
  LOW: 4,
};

export function toBullMQPriority(priority: JobPriority): number {
  return PRIORITY_TO_BULLMQ[priority];
}
