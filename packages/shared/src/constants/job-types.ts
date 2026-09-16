/**
 * The canonical list of job types TaskFlow currently knows how to run.
 *
 * Job.type is stored as a plain string column in Postgres (see
 * docs/database.md), so this array — not a database enum — is the single
 * source of truth for "which job types exist right now". Both the API
 * (to validate incoming job creation requests) and the Worker (to look up
 * the right handler) import from here.
 *
 * Adding a new job type later means: add a value here, add a Zod payload
 * schema in schemas/, add a handler class in apps/worker/src/jobs. No
 * database migration required.
 */
export const JOB_TYPES = [
  'CSV_PROCESSING',
  'API_REQUEST',
  'EMAIL',
  'REPORT_GENERATION',
  'IMAGE_PROCESSING',
  'SCHEDULED_API_FETCH',
  'DATA_TRANSFORMATION',
] as const;

export type JobType = (typeof JOB_TYPES)[number];

export const JOB_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type JobPriority = (typeof JOB_PRIORITIES)[number];

export const JOB_STATUSES = [
  'PENDING',
  'QUEUED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'RETRYING',
  'CANCELLED',
  'DEAD_LETTER',
] as const;
export type JobStatusValue = (typeof JOB_STATUSES)[number];
