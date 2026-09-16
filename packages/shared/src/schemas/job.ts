import { z } from 'zod';
import { JOB_TYPES, JOB_PRIORITIES } from '../constants/job-types';

/**
 * Validates the shape of every incoming "create job" request, regardless
 * of job type. Per-type payload shape (e.g. what an API_REQUEST payload
 * must contain) is validated separately by that job type's own schema,
 * which will live alongside its handler once each job type is implemented.
 *
 * This two-layer approach (generic envelope here, specific payload later)
 * is what lets POST /api/v1/jobs stay generic while still rejecting a
 * malformed payload before it ever reaches a worker.
 */
export const createJobSchema = z.object({
  name: z.string().min(1, 'Job name is required').max(200),
  type: z.enum(JOB_TYPES),
  priority: z.enum(JOB_PRIORITIES).default('MEDIUM'),
  payload: z.record(z.unknown()),
  scheduledAt: z.coerce.date().optional(),
  // Optional: overrides the schema's default of 3. Bounded at 10 so a
  // typo (or a hostile client) can't configure a job to retry
  // effectively forever against a struggling downstream dependency.
  maxAttempts: z.coerce.number().int().min(1).max(10).optional(),
});

export type CreateJobInput = z.infer<typeof createJobSchema>;

/**
 * The (optional) body of a manual retry request. See docs/queue-system.md
 * ("Manual retries: a fresh cycle, not an extension") for why this grants
 * a fresh attempts budget rather than extending the exhausted one.
 */
export const retryJobSchema = z.object({
  maxAttempts: z.coerce.number().int().min(1).max(10).optional(),
});
export type RetryJobInput = z.infer<typeof retryJobSchema>;
