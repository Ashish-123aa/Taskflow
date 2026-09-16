import {
  JOB_PAYLOAD_SCHEMAS,
  getNextRunDate,
  type CreateScheduleInput,
  type UpdateScheduleInput,
} from '@taskflow/shared';
import { scheduleRepository } from '../repositories/schedule.repository';
import { ForbiddenError, NotFoundError } from '../utils/errors';

interface CreateScheduleParams extends CreateScheduleInput {
  userId: string;
}

function assertOwnership(schedule: { userId: string }, userId: string): void {
  // No admin override here, same reasoning as notificationService —
  // section 5's admin capability list doesn't mention schedules, so this
  // stays strictly self-service.
  if (schedule.userId !== userId) {
    throw new ForbiddenError('You do not have access to this schedule');
  }
}

export const scheduleService = {
  async createSchedule(params: CreateScheduleParams) {
    // Validated the same way a job's payload is at creation time — a
    // schedule is, in effect, a template for repeatedly creating jobs of
    // a given type, so its payload has to satisfy that type's schema
    // just as strictly as a one-off job's does.
    const validatedPayload = JOB_PAYLOAD_SCHEMAS[params.jobType].parse(params.payload);

    return scheduleRepository.create({
      user: { connect: { id: params.userId } },
      name: params.name,
      jobType: params.jobType,
      payload: validatedPayload as object,
      cronExpression: params.cronExpression,
      priority: params.priority,
      ...(params.maxAttempts ? { maxAttempts: params.maxAttempts } : {}),
      // Computed once at creation; every trigger thereafter recomputes it
      // from the moment it actually fires (see scheduler/scheduler.ts) —
      // this initial value is what makes a freshly created schedule
      // immediately visible with a real "next run" time instead of null
      // until the first tick happens to notice it.
      nextRunAt: getNextRunDate(params.cronExpression),
    });
  },

  async getSchedule(id: string, userId: string) {
    const schedule = await scheduleRepository.findById(id);
    if (!schedule) throw new NotFoundError('Schedule');
    assertOwnership(schedule, userId);
    return schedule;
  },

  listSchedules(userId: string, params: { page: number; limit: number }) {
    return scheduleRepository.findMany({ userId, ...params });
  },

  async updateSchedule(id: string, userId: string, input: UpdateScheduleInput) {
    const schedule = await scheduleRepository.findById(id);
    if (!schedule) throw new NotFoundError('Schedule');
    assertOwnership(schedule, userId);

    // jobType is deliberately not updatable via PATCH — changing it would
    // mean re-validating payload against a different type's schema and
    // potentially invalidating a payload that made perfect sense for the
    // old type. Wanting to run a different job type on this cron pattern
    // is closer to "make a new schedule" than "edit this one".
    const validatedPayload = input.payload
      ? JOB_PAYLOAD_SCHEMAS[schedule.jobType as CreateScheduleInput['jobType']].parse(input.payload)
      : undefined;

    return scheduleRepository.update(id, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(validatedPayload !== undefined ? { payload: validatedPayload as object } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.maxAttempts !== undefined ? { maxAttempts: input.maxAttempts } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(input.cronExpression !== undefined
        ? { cronExpression: input.cronExpression, nextRunAt: getNextRunDate(input.cronExpression) }
        : {}),
    });
  },

  async deleteSchedule(id: string, userId: string) {
    const schedule = await scheduleRepository.findById(id);
    if (!schedule) throw new NotFoundError('Schedule');
    assertOwnership(schedule, userId);
    await scheduleRepository.remove(id);
  },
};
