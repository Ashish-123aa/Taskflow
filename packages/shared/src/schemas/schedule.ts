import { z } from 'zod';
import { JOB_TYPES, JOB_PRIORITIES } from '../constants/job-types';
import { isValidCronExpression } from '../scheduling/cron';

const cronExpressionSchema = z
  .string()
  .min(1, 'A cron expression is required')
  .refine(isValidCronExpression, {
    message: 'Not a valid cron expression (expected 5 fields, e.g. "0 8 * * *" for daily at 8am)',
  });

export const createScheduleSchema = z.object({
  name: z.string().min(1, 'Schedule name is required').max(200),
  jobType: z.enum(JOB_TYPES),
  payload: z.record(z.unknown()),
  cronExpression: cronExpressionSchema,
  priority: z.enum(JOB_PRIORITIES).default('MEDIUM'),
  maxAttempts: z.coerce.number().int().min(1).max(10).optional(),
});
export type CreateScheduleInput = z.infer<typeof createScheduleSchema>;

/**
 * Every field optional (a PATCH updates only what's provided), but each
 * one that *is* provided is validated exactly as strictly as it would be
 * at creation — a partial update isn't a loosely-validated update.
 */
export const updateScheduleSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  payload: z.record(z.unknown()).optional(),
  cronExpression: cronExpressionSchema.optional(),
  priority: z.enum(JOB_PRIORITIES).optional(),
  maxAttempts: z.coerce.number().int().min(1).max(10).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateScheduleInput = z.infer<typeof updateScheduleSchema>;
