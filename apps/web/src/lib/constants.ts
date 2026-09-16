/**
 * Deliberately duplicated from packages/shared's constants/job-types.ts,
 * not imported from it. @taskflow/shared's barrel export eagerly pulls in
 * Node-only modules (a live PrismaClient, ioredis, winston) that would
 * break or bloat a browser bundle. Rather than risk that, or take on a
 * bigger package-splitting refactor mid-phase, the frontend keeps its own
 * small, browser-safe copy of just the values it needs — see
 * docs/frontend.md ("Why the frontend doesn't import @taskflow/shared")
 * for the full reasoning and what a proper fix would look like.
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
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_TYPE_LABELS: Record<JobType, string> = {
  CSV_PROCESSING: 'CSV Processing',
  API_REQUEST: 'API Request',
  EMAIL: 'Email',
  REPORT_GENERATION: 'Report Generation',
  IMAGE_PROCESSING: 'Image Processing',
  SCHEDULED_API_FETCH: 'Scheduled API Fetch',
  DATA_TRANSFORMATION: 'Data Transformation',
};

export const STATUS_LABELS: Record<JobStatus, string> = {
  PENDING: 'Pending',
  QUEUED: 'Queued',
  RUNNING: 'Running',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  RETRYING: 'Retrying',
  CANCELLED: 'Cancelled',
  DEAD_LETTER: 'Dead Letter',
};
