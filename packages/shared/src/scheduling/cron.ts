import { CronExpressionParser } from 'cron-parser';

/**
 * Computes when a cron expression next fires, relative to `from` (default:
 * now). Used in two places that must never disagree: validating a
 * schedule's cronExpression at creation time (reject "not-a-cron" before
 * it's ever stored — see schemas/schedule.ts), and computing the next
 * `nextRunAt` after every trigger (apps/api/src/scheduler/scheduler.ts).
 * Throws if the expression is invalid — callers decide how to surface
 * that (a Zod `.refine()` for user input, a logged error for a
 * previously-valid schedule that somehow became invalid).
 */
export function getNextRunDate(cronExpression: string, from: Date = new Date()): Date {
  const interval = CronExpressionParser.parse(cronExpression, { currentDate: from });
  return interval.next().toDate();
}

export function isValidCronExpression(cronExpression: string): boolean {
  // cron-parser itself treats an empty string as valid (defaulting to
  // "every minute"), which isn't a useful answer for a function whose
  // whole job is "is this actually a cron expression". Guarded here
  // directly rather than relying on every caller to check length first.
  if (!cronExpression.trim()) return false;
  try {
    CronExpressionParser.parse(cronExpression);
    return true;
  } catch {
    return false;
  }
}
