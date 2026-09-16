import cron, { type ScheduledTask } from 'node-cron';
import type { Schedule } from '@taskflow/shared';
import { getNextRunDate, type CreateJobInput } from '@taskflow/shared';
import { scheduleRepository } from '../repositories/schedule.repository';
import { notificationRepository } from '../repositories/notification.repository';
import { jobService } from '../services/job.service';
import { logger } from '../config/logger';

/**
 * Starts the scheduler: a cron tick, running inside this API process,
 * that checks for due schedules once a minute. Per section 19 ("Do not
 * execute the task directly inside the scheduler"), this never runs a
 * job's actual logic — it only ever creates a `Job` row and hands it to
 * `jobService.createJob`, the exact same path `POST /api/v1/jobs` uses.
 * See docs/scheduling.md for why this lives in the API process (reusing
 * jobService) rather than the worker.
 */
export function startScheduler(): ScheduledTask {
  // Once a minute is as granular as the standard 5-field cron syntax
  // this project uses gets anyway (no seconds field), and cheap enough to
  // poll at that frequency even with a large number of schedules.
  return cron.schedule('* * * * *', () => {
    void runDueSchedules().catch((err) => {
      logger.error('Scheduler tick failed', { error: err });
    });
  });
}

/**
 * Exported separately from the cron wiring above specifically so a test
 * can invoke exactly one tick's worth of work on demand, instead of
 * waiting for node-cron's real timer — see
 * apps/api/tests/schedules.test.ts.
 */
export async function runDueSchedules(): Promise<void> {
  const dueSchedules = await scheduleRepository.findDue(new Date());
  for (const schedule of dueSchedules) {
    await triggerSchedule(schedule);
  }
}

async function triggerSchedule(schedule: Schedule): Promise<void> {
  try {
    const job = await jobService.createJob({
      userId: schedule.userId,
      name: schedule.name,
      type: schedule.jobType as CreateJobInput['type'],
      priority: schedule.priority,
      payload: schedule.payload as Record<string, unknown>,
      ...(schedule.maxAttempts ? { maxAttempts: schedule.maxAttempts } : {}),
    });

    await scheduleRepository.update(schedule.id, {
      lastRunAt: new Date(),
      nextRunAt: getNextRunDate(schedule.cronExpression),
      lastError: null,
    });

    await notificationRepository.create({
      userId: schedule.userId,
      jobId: job.id,
      type: 'SCHEDULE_TRIGGERED',
      message: `Scheduled job "${schedule.name}" triggered a new run.`,
    });

    logger.info('Schedule triggered', { scheduleId: schedule.id, jobId: job.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Failed to trigger schedule', { scheduleId: schedule.id, error: message });

    // Still advance nextRunAt even though this trigger failed — otherwise
    // a schedule whose payload became invalid (e.g. the target job
    // type's validation rules changed after the schedule was created)
    // would be picked up again on every single tick, forever, instead of
    // waiting for its next real occurrence. lastError makes the failure
    // visible without that.
    await scheduleRepository.update(schedule.id, {
      nextRunAt: getNextRunDate(schedule.cronExpression),
      lastError: message,
    });
  }
}
