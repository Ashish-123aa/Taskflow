import { z } from 'zod';
import type { JobType } from '../constants/job-types';

export const apiRequestPayloadSchema = z.object({
  url: z.string().url(),
  method: z.enum(['GET', 'POST']).optional(),
  headers: z.record(z.string()).optional(),
  body: z.unknown().optional(),
});

export const emailPayloadSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1).max(200),
  body: z.string().min(1),
});

const transformOperationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('filter'),
    field: z.string(),
    operator: z.enum(['eq', 'neq', 'gt', 'lt', 'contains']),
    value: z.unknown(),
  }),
  z.object({
    type: z.literal('map'),
    field: z.string(),
    transform: z.enum(['uppercase', 'lowercase', 'trim', 'toNumber', 'toString']),
  }),
  z.object({
    type: z.literal('sort'),
    field: z.string(),
    direction: z.enum(['asc', 'desc']).default('asc'),
  }),
]);

export const dataTransformationPayloadSchema = z.object({
  input: z.array(z.record(z.unknown())),
  operations: z.array(transformOperationSchema),
});

// CSV_PROCESSING and IMAGE_PROCESSING payloads are produced exclusively by
// TaskFlow's own upload endpoints (apps/api/src/controllers/job.controller.ts)
// after multer has already validated the file — never typed directly by a
// user as freeform JSON — so these schemas exist mainly as a shape
// contract between the upload controller and the worker handler, not as a
// user-input firewall the way the others are.
export const csvProcessingPayloadSchema = z.object({
  storedFilename: z.string().min(1),
  originalFilename: z.string().min(1),
  sizeBytes: z.number().nonnegative(),
});

export const imageProcessingPayloadSchema = z.object({
  storedFilename: z.string().min(1),
  originalFilename: z.string().min(1),
  operations: z
    .object({
      resize: z
        .object({
          width: z.number().int().positive().optional(),
          height: z.number().int().positive().optional(),
        })
        .optional(),
      format: z.enum(['jpeg', 'png', 'webp']).optional(),
    })
    .default({}),
});

export const reportGenerationPayloadSchema = z.object({
  reportType: z.literal('JOB_SUMMARY').default('JOB_SUMMARY'),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
});

/**
 * One schema per job type, keyed so `jobService.createJob` can validate a
 * job's payload against exactly the shape its type requires — not just
 * "is this an object" (the generic envelope check in schemas/job.ts), but
 * "does an API_REQUEST payload actually have a valid url". `satisfies
 * Record<JobType, z.ZodTypeAny>` (rather than a type annotation) keeps
 * each schema's own inferred type intact while still making TypeScript
 * fail to compile if a JobType is ever added to job-types.ts without a
 * matching entry here.
 *
 * SCHEDULED_API_FETCH intentionally reuses apiRequestPayloadSchema — see
 * docs/worker-system.md for why it shares API_REQUEST's implementation
 * entirely, not just its payload shape.
 */
export const JOB_PAYLOAD_SCHEMAS = {
  API_REQUEST: apiRequestPayloadSchema,
  SCHEDULED_API_FETCH: apiRequestPayloadSchema,
  EMAIL: emailPayloadSchema,
  DATA_TRANSFORMATION: dataTransformationPayloadSchema,
  CSV_PROCESSING: csvProcessingPayloadSchema,
  IMAGE_PROCESSING: imageProcessingPayloadSchema,
  REPORT_GENERATION: reportGenerationPayloadSchema,
} satisfies Record<JobType, z.ZodTypeAny>;
