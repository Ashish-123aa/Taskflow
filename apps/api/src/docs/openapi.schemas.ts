/**
 * Component schemas for the hand-maintained OpenAPI document
 * (docs/openapi.ts). These mirror the real shapes defined in
 * packages/shared/src/schemas/*.ts, packages/shared/prisma/schema.prisma,
 * and packages/shared/src/types/auth.ts — kept here as plain OpenAPI
 * schema objects rather than derived from the Zod schemas at build time,
 * since adding a Zod→OpenAPI generator would be exactly the kind of
 * extra documentation framework this phase was asked not to introduce.
 * The trade-off is the same one `apps/web/src/lib/constants.ts` already
 * accepts for its own hand-copied constants (see docs/frontend.md): a
 * manually-kept-in-sync copy is a real, ongoing cost, worth it here to
 * avoid a second dependency and a generation step for a spec this small.
 */

const role = {
  type: 'string',
  enum: ['USER', 'ADMIN'],
} as const;

const jobType = {
  type: 'string',
  enum: [
    'CSV_PROCESSING',
    'API_REQUEST',
    'EMAIL',
    'REPORT_GENERATION',
    'IMAGE_PROCESSING',
    'SCHEDULED_API_FETCH',
    'DATA_TRANSFORMATION',
  ],
} as const;

const jobPriority = {
  type: 'string',
  enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
} as const;

const jobStatus = {
  type: 'string',
  enum: ['PENDING', 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'RETRYING', 'CANCELLED', 'DEAD_LETTER'],
} as const;

const notificationType = {
  type: 'string',
  enum: ['JOB_COMPLETED', 'JOB_FAILED', 'JOB_DEAD_LETTER', 'SCHEDULE_TRIGGERED', 'SYSTEM_ERROR'],
} as const;

const safeUser = {
  type: 'object',
  description: 'A user with passwordHash omitted — see docs/security.md ("Password storage").',
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    email: { type: 'string', format: 'email' },
    role,
    isActive: { type: 'boolean' },
    createdAt: { type: 'string', format: 'date-time' },
  },
  required: ['id', 'name', 'email', 'role', 'isActive', 'createdAt'],
} as const;

const jobAttempt = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    jobId: { type: 'string', format: 'uuid' },
    attemptNumber: { type: 'integer', description: 'Lifetime-cumulative — see docs/queue-system.md.' },
    status: { type: 'string', enum: ['RUNNING', 'SUCCEEDED', 'FAILED'] },
    startedAt: { type: 'string', format: 'date-time' },
    completedAt: { type: 'string', format: 'date-time', nullable: true },
    error: { type: 'string', nullable: true },
    duration: { type: 'integer', nullable: true, description: 'Milliseconds.' },
  },
  required: ['id', 'jobId', 'attemptNumber', 'status', 'startedAt', 'completedAt', 'error', 'duration'],
} as const;

const job = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    userId: { type: 'string', format: 'uuid' },
    type: jobType,
    name: { type: 'string' },
    status: jobStatus,
    priority: jobPriority,
    payload: {
      type: 'object',
      additionalProperties: true,
      description: 'Shape depends on `type` — see the payload schemas listed under each job-creation request body.',
    },
    result: { type: 'object', additionalProperties: true, nullable: true },
    error: { type: 'string', nullable: true },
    progress: { type: 'integer', minimum: 0, maximum: 100 },
    attempts: { type: 'integer' },
    maxAttempts: { type: 'integer' },
    scheduledAt: { type: 'string', format: 'date-time', nullable: true },
    startedAt: { type: 'string', format: 'date-time', nullable: true },
    completedAt: { type: 'string', format: 'date-time', nullable: true },
    failedAt: { type: 'string', format: 'date-time', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    jobAttempts: {
      type: 'array',
      items: jobAttempt,
      description: 'Only populated on GET /jobs/{id} (the list endpoints omit it).',
    },
  },
  required: [
    'id',
    'userId',
    'type',
    'name',
    'status',
    'priority',
    'payload',
    'result',
    'error',
    'progress',
    'attempts',
    'maxAttempts',
    'createdAt',
    'updatedAt',
  ],
} as const;

const schedule = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    userId: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    jobType,
    payload: { type: 'object', additionalProperties: true },
    cronExpression: { type: 'string', example: '0 8 * * *' },
    priority: jobPriority,
    maxAttempts: { type: 'integer', nullable: true },
    isActive: { type: 'boolean' },
    nextRunAt: { type: 'string', format: 'date-time', nullable: true },
    lastRunAt: { type: 'string', format: 'date-time', nullable: true },
    lastError: {
      type: 'string',
      nullable: true,
      description: 'Set when the most recent trigger failed; cleared on the next successful one.',
    },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
  required: [
    'id',
    'userId',
    'name',
    'jobType',
    'payload',
    'cronExpression',
    'priority',
    'maxAttempts',
    'isActive',
    'nextRunAt',
    'lastRunAt',
    'lastError',
    'createdAt',
    'updatedAt',
  ],
} as const;

const notification = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    userId: { type: 'string', format: 'uuid' },
    jobId: { type: 'string', format: 'uuid', nullable: true },
    type: notificationType,
    message: { type: 'string' },
    isRead: { type: 'boolean' },
    createdAt: { type: 'string', format: 'date-time' },
  },
  required: ['id', 'userId', 'jobId', 'type', 'message', 'isRead', 'createdAt'],
} as const;

const auditLog = {
  type: 'object',
  description:
    'A record of an admin acting on a resource that is not theirs — see docs/admin.md ("Audit logging"). ' +
    '`userId` is always the *acting* admin, never the target of the action.',
  properties: {
    id: { type: 'string', format: 'uuid' },
    userId: { type: 'string', format: 'uuid', nullable: true },
    action: { type: 'string', example: 'ADMIN_JOB_CANCEL' },
    resource: { type: 'string', example: 'Job' },
    resourceId: { type: 'string', nullable: true },
    metadata: { type: 'object', additionalProperties: true, nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
  },
  required: ['id', 'userId', 'action', 'resource', 'resourceId', 'metadata', 'createdAt'],
} as const;

const dashboardStats = {
  type: 'object',
  properties: {
    totalJobs: { type: 'integer' },
    completedJobs: { type: 'integer' },
    runningJobs: { type: 'integer' },
    failedJobs: { type: 'integer', description: 'FAILED and DEAD_LETTER combined — see dashboard.service.ts.' },
    queuedJobs: { type: 'integer', description: 'PENDING and QUEUED combined.' },
    successRate: { type: 'number', description: 'Percentage, 0-100.' },
    avgProcessingTimeMs: { type: 'number' },
    jobsByType: {
      type: 'array',
      items: { type: 'object', properties: { type: { type: 'string' }, count: { type: 'integer' } } },
    },
    jobsByStatus: {
      type: 'array',
      items: { type: 'object', properties: { status: { type: 'string' }, count: { type: 'integer' } } },
    },
    jobsOverTime: {
      type: 'array',
      description: 'One entry per day for the last 14 days, including zero-job days.',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string', example: '2026-01-15' },
          total: { type: 'integer' },
          completed: { type: 'integer' },
          failed: { type: 'integer' },
        },
      },
    },
  },
} as const;

const pagination = {
  type: 'object',
  properties: {
    page: { type: 'integer' },
    limit: { type: 'integer' },
    total: { type: 'integer' },
    totalPages: { type: 'integer' },
  },
  required: ['page', 'limit', 'total', 'totalPages'],
} as const;

const apiError = {
  type: 'object',
  description: 'The shape every error response takes, regardless of cause — see middleware/errorHandler.ts.',
  properties: {
    success: { type: 'boolean', enum: [false] },
    message: { type: 'string' },
    errorCode: { type: 'string', example: 'VALIDATION_ERROR' },
    details: { description: 'Present for VALIDATION_ERROR: a list of { path, message } issues.' },
  },
  required: ['success', 'message', 'errorCode'],
} as const;

// ── Request bodies ─────────────────────────────────────────────────────

const registerInput = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 2, maxLength: 100 },
    email: { type: 'string', format: 'email' },
    password: {
      type: 'string',
      minLength: 8,
      description: 'Must contain at least one uppercase letter, one lowercase letter, and one number.',
    },
  },
  required: ['name', 'email', 'password'],
} as const;

const loginInput = {
  type: 'object',
  properties: {
    email: { type: 'string', format: 'email' },
    password: { type: 'string' },
  },
  required: ['email', 'password'],
} as const;

const createJobInput = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 200 },
    type: jobType,
    priority: { ...jobPriority, default: 'MEDIUM' },
    payload: {
      type: 'object',
      additionalProperties: true,
      description: 'Validated against a per-type schema server-side — e.g. API_REQUEST requires a "url".',
    },
    scheduledAt: { type: 'string', format: 'date-time' },
    maxAttempts: { type: 'integer', minimum: 1, maximum: 10, description: 'Defaults to 3 if omitted.' },
  },
  required: ['name', 'type', 'payload'],
} as const;

const retryJobInput = {
  type: 'object',
  description: 'Optional body — omit entirely to retry at the job\'s existing maxAttempts.',
  properties: {
    maxAttempts: {
      type: 'integer',
      minimum: 1,
      maximum: 10,
      description: 'A fresh attempts budget for this retry cycle — see docs/queue-system.md.',
    },
  },
} as const;

const createScheduleInput = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 200 },
    jobType,
    payload: { type: 'object', additionalProperties: true },
    cronExpression: { type: 'string', example: '0 8 * * *' },
    priority: { ...jobPriority, default: 'MEDIUM' },
    maxAttempts: { type: 'integer', minimum: 1, maximum: 10 },
  },
  required: ['name', 'jobType', 'payload', 'cronExpression'],
} as const;

const updateScheduleInput = {
  type: 'object',
  description: 'Every field optional — only what is provided gets updated. jobType cannot be changed; see docs/scheduling.md.',
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 200 },
    payload: { type: 'object', additionalProperties: true },
    cronExpression: { type: 'string' },
    priority: jobPriority,
    maxAttempts: { type: 'integer', minimum: 1, maximum: 10 },
    isActive: { type: 'boolean' },
  },
} as const;

const setUserActiveInput = {
  type: 'object',
  properties: {
    isActive: { type: 'boolean' },
  },
  required: ['isActive'],
} as const;

export const openApiSchemas = {
  Role: role,
  JobType: jobType,
  JobPriority: jobPriority,
  JobStatus: jobStatus,
  NotificationType: notificationType,
  SafeUser: safeUser,
  JobAttempt: jobAttempt,
  Job: job,
  Schedule: schedule,
  Notification: notification,
  AuditLog: auditLog,
  DashboardStats: dashboardStats,
  Pagination: pagination,
  ApiError: apiError,
  RegisterInput: registerInput,
  LoginInput: loginInput,
  CreateJobInput: createJobInput,
  RetryJobInput: retryJobInput,
  CreateScheduleInput: createScheduleInput,
  UpdateScheduleInput: updateScheduleInput,
  SetUserActiveInput: setUserActiveInput,
};
