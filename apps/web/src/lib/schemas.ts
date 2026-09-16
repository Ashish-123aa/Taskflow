import { z } from 'zod';
import { JOB_TYPES, JOB_PRIORITIES } from './constants';

// Mirrors packages/shared/src/schemas/auth.ts — see lib/constants.ts for
// why this is a deliberate copy, not an import.
export const loginSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});
export type LoginFormValues = z.infer<typeof loginSchema>;

export const registerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  email: z.string().email('Enter a valid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Include at least one uppercase letter')
    .regex(/[a-z]/, 'Include at least one lowercase letter')
    .regex(/[0-9]/, 'Include at least one number'),
});
export type RegisterFormValues = z.infer<typeof registerSchema>;

export const createJobSchema = z.object({
  name: z.string().min(1, 'Job name is required').max(200),
  type: z.enum(JOB_TYPES),
  priority: z.enum(JOB_PRIORITIES),
  payload: z.record(z.unknown()),
  maxAttempts: z.coerce.number().int().min(1).max(10).optional(),
});
export type CreateJobFormValues = z.infer<typeof createJobSchema>;

export const createScheduleSchema = z.object({
  name: z.string().min(1, 'Schedule name is required').max(200),
  jobType: z.enum(JOB_TYPES),
  cronExpression: z.string().min(1, 'A cron expression is required'),
  priority: z.enum(JOB_PRIORITIES),
  payload: z.record(z.unknown()),
  maxAttempts: z.coerce.number().int().min(1).max(10).optional(),
});
export type CreateScheduleFormValues = z.infer<typeof createScheduleSchema>;
