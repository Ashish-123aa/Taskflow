/**
 * Path definitions for the hand-maintained OpenAPI document
 * (docs/openapi.ts) — one entry per real route in routes/*.ts. Kept in
 * sync by hand alongside route changes; see the top of openapi.schemas.ts
 * for why this isn't generated from the Zod schemas automatically.
 */

const cookieAuth = [{ cookieAuth: [] as string[] }];

const jsonBody = (schemaRef: object) => ({
  required: true,
  content: { 'application/json': { schema: schemaRef } },
});

const successSchema = (dataSchema: object, extra: Record<string, object> = {}) => ({
  type: 'object',
  properties: { success: { type: 'boolean', enum: [true] }, data: dataSchema, ...extra },
  required: ['success', 'data'],
});

const ok = (dataSchema: object, extra: Record<string, object> = {}) => ({
  description: 'Success.',
  content: { 'application/json': { schema: successSchema(dataSchema, extra) } },
});

const paginatedOk = (itemSchema: object) =>
  ok(
    { type: 'array', items: itemSchema },
    { pagination: { $ref: '#/components/schemas/Pagination' } },
  );

const err = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
});

const pageParam = { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } };
const limitParam = {
  name: 'limit',
  in: 'query',
  schema: { type: 'integer', default: 20, maximum: 100 },
};

const messageOk = {
  description: 'Success.',
  content: {
    'application/json': {
      schema: successSchema({
        type: 'object',
        properties: { message: { type: 'string' } },
      }),
    },
  },
};

export const openApiPaths = {
  '/auth/register': {
    post: {
      tags: ['Auth'],
      summary: 'Create an account',
      description:
        'No authentication required. Sets the session cookie on success, exactly like /auth/login. ' +
        'Rate limited to RATE_LIMIT_AUTH_MAX attempts per RATE_LIMIT_AUTH_WINDOW_MS, shared with /auth/login — see docs/security.md ("Rate limiting").',
      security: [],
      requestBody: jsonBody({ $ref: '#/components/schemas/RegisterInput' }),
      responses: {
        '201': ok({ $ref: '#/components/schemas/SafeUser' }),
        '400': err('Validation failed (weak password, invalid email, etc).'),
        '409': err('An account with this email already exists.'),
        '429': err('Too many attempts — see the Retry-After header.'),
      },
    },
  },
  '/auth/login': {
    post: {
      tags: ['Auth'],
      summary: 'Log in',
      description:
        'No authentication required. Returns the same error for a nonexistent email as for a wrong ' +
        'password (see docs/security.md) to avoid leaking which emails have accounts. Rate limited ' +
        'alongside /auth/register.',
      security: [],
      requestBody: jsonBody({ $ref: '#/components/schemas/LoginInput' }),
      responses: {
        '200': ok({ $ref: '#/components/schemas/SafeUser' }),
        '401': err('Invalid email or password.'),
        '403': err('This account has been disabled.'),
        '429': err('Too many attempts — see the Retry-After header.'),
      },
    },
  },
  '/auth/logout': {
    post: {
      tags: ['Auth'],
      summary: 'Log out',
      description:
        'Clears the session cookie. The JWT itself is not server-side revocable (see docs/security.md, ' +
        '"The stateless-JWT trade-off") — this only stops the browser from sending it again.',
      security: [],
      responses: { '200': messageOk },
    },
  },
  '/auth/me': {
    get: {
      tags: ['Auth'],
      summary: 'Get the current session',
      security: cookieAuth,
      responses: {
        '200': ok({ $ref: '#/components/schemas/SafeUser' }),
        '401': err('Not logged in.'),
      },
    },
  },
  '/jobs': {
    post: {
      tags: ['Jobs'],
      summary: 'Create a job',
      description:
        'Rate limited to RATE_LIMIT_JOB_CREATE_MAX per RATE_LIMIT_JOB_CREATE_WINDOW_MS, per account ' +
        '(shared with the two upload endpoints below — all three create a job the same way).',
      security: cookieAuth,
      requestBody: jsonBody({ $ref: '#/components/schemas/CreateJobInput' }),
      responses: {
        '201': ok({ $ref: '#/components/schemas/Job' }),
        '400': err('Validation failed, at the envelope level or the job type\'s own payload schema.'),
        '429': err('Too many attempts — see the Retry-After header.'),
      },
    },
    get: {
      tags: ['Jobs'],
      summary: "List the caller's own jobs",
      description: 'Always scoped to the requesting user — including for admins. See docs/admin.md.',
      security: cookieAuth,
      parameters: [
        pageParam,
        limitParam,
        { name: 'status', in: 'query', schema: { $ref: '#/components/schemas/JobStatus' } },
        { name: 'type', in: 'query', schema: { $ref: '#/components/schemas/JobType' } },
        { name: 'priority', in: 'query', schema: { $ref: '#/components/schemas/JobPriority' } },
      ],
      responses: { '200': paginatedOk({ $ref: '#/components/schemas/Job' }) },
    },
  },
  '/jobs/upload/csv': {
    post: {
      tags: ['Jobs'],
      summary: 'Create a CSV_PROCESSING job by uploading a file',
      description:
        'multipart/form-data. Fields: `file` (required, .csv), `name` (optional), `priority` (optional). ' +
        'The stored filename is always a fresh random UUID, never the client-supplied name — see docs/file-handling.md.',
      security: cookieAuth,
      requestBody: {
        required: true,
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              properties: {
                file: { type: 'string', format: 'binary' },
                name: { type: 'string' },
                priority: { $ref: '#/components/schemas/JobPriority' },
              },
              required: ['file'],
            },
          },
        },
      },
      responses: {
        '201': ok({ $ref: '#/components/schemas/Job' }),
        '400': err('No file uploaded, or the file is not a CSV.'),
        '429': err('Too many attempts — see the Retry-After header.'),
      },
    },
  },
  '/jobs/upload/image': {
    post: {
      tags: ['Jobs'],
      summary: 'Create an IMAGE_PROCESSING job by uploading a file',
      description:
        'multipart/form-data. Fields: `file` (required, JPEG/PNG/WebP), `name` (optional), `priority` ' +
        '(optional), `operations` (optional, a JSON-encoded string, e.g. `{"resize":{"width":800}}`).',
      security: cookieAuth,
      requestBody: {
        required: true,
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              properties: {
                file: { type: 'string', format: 'binary' },
                name: { type: 'string' },
                priority: { $ref: '#/components/schemas/JobPriority' },
                operations: { type: 'string', description: 'JSON-encoded string.' },
              },
              required: ['file'],
            },
          },
        },
      },
      responses: {
        '201': ok({ $ref: '#/components/schemas/Job' }),
        '400': err('No file uploaded, the file is not an accepted image type, or "operations" is not valid JSON.'),
        '429': err('Too many attempts — see the Retry-After header.'),
      },
    },
  },
  '/jobs/{id}': {
    get: {
      tags: ['Jobs'],
      summary: 'Get a job by ID',
      description: 'Includes `jobAttempts` (omitted from the list endpoints). Admins may view any job.',
      security: cookieAuth,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: {
        '200': ok({ $ref: '#/components/schemas/Job' }),
        '403': err('This job belongs to another user and the caller is not an admin.'),
        '404': err('No job with this ID.'),
      },
    },
    delete: {
      tags: ['Jobs'],
      summary: 'Delete a job',
      description: 'Only a COMPLETED, FAILED, CANCELLED, or DEAD_LETTER job can be deleted — cancel a running/queued one first.',
      security: cookieAuth,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: {
        '200': messageOk,
        '403': err('This job belongs to another user and the caller is not an admin.'),
        '404': err('No job with this ID.'),
        '409': err('The job is still QUEUED or RUNNING.'),
      },
    },
  },
  '/jobs/{id}/download': {
    get: {
      tags: ['Jobs'],
      summary: "Download a completed job's generated file",
      description: 'Only meaningful for REPORT_GENERATION and IMAGE_PROCESSING results that produced a file.',
      security: cookieAuth,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: {
        '200': { description: 'The file, as a binary download.', content: { '*/*': { schema: { type: 'string', format: 'binary' } } } },
        '404': err('No job with this ID, or it has no downloadable result.'),
      },
    },
  },
  '/jobs/{id}/cancel': {
    post: {
      tags: ['Jobs'],
      summary: 'Cancel a job',
      description: 'Only a PENDING or QUEUED job can be cancelled. Admins may cancel any job (audited — see docs/admin.md).',
      security: cookieAuth,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: {
        '200': ok({ $ref: '#/components/schemas/Job' }),
        '403': err('This job belongs to another user and the caller is not an admin.'),
        '404': err('No job with this ID.'),
        '409': err('The job is not in a cancellable state.'),
      },
    },
  },
  '/jobs/{id}/retry': {
    post: {
      tags: ['Jobs'],
      summary: 'Retry a failed job',
      description:
        'Only a FAILED or DEAD_LETTER job can be retried. Grants a *fresh* attempts budget — see ' +
        'docs/queue-system.md ("Manual retries: a fresh cycle, not an extension"). Admins may retry any job (audited).',
      security: cookieAuth,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      requestBody: {
        required: false,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/RetryJobInput' } } },
      },
      responses: {
        '200': ok({ $ref: '#/components/schemas/Job' }),
        '403': err('This job belongs to another user and the caller is not an admin.'),
        '404': err('No job with this ID.'),
        '409': err('The job is not in a retryable state.'),
      },
    },
  },
  '/admin/jobs': {
    get: {
      tags: ['Admin'],
      summary: 'List every job across every user',
      description:
        'Requires the ADMIN role. Unlike GET /jobs, not scoped to the caller — see docs/admin.md for why ' +
        'this is a separate endpoint rather than a role branch on GET /jobs. ' +
        '`status=DEAD_LETTER` is the dead-letter inspection view (section 13).',
      security: cookieAuth,
      parameters: [
        pageParam,
        limitParam,
        { name: 'status', in: 'query', schema: { $ref: '#/components/schemas/JobStatus' } },
        { name: 'type', in: 'query', schema: { $ref: '#/components/schemas/JobType' } },
        { name: 'priority', in: 'query', schema: { $ref: '#/components/schemas/JobPriority' } },
        { name: 'userId', in: 'query', schema: { type: 'string', format: 'uuid' }, description: 'Narrow to one user\'s jobs.' },
      ],
      responses: {
        '200': paginatedOk({ $ref: '#/components/schemas/Job' }),
        '403': err('The caller is authenticated but not an admin.'),
      },
    },
  },
  '/admin/users': {
    get: {
      tags: ['Admin'],
      summary: 'List every user account',
      description: 'Requires the ADMIN role. Never includes passwordHash — see docs/admin.md.',
      security: cookieAuth,
      parameters: [pageParam, limitParam],
      responses: {
        '200': paginatedOk({ $ref: '#/components/schemas/SafeUser' }),
        '403': err('The caller is authenticated but not an admin.'),
      },
    },
  },
  '/admin/users/{id}': {
    patch: {
      tags: ['Admin'],
      summary: 'Enable or disable a user account',
      description:
        'Requires the ADMIN role. An admin cannot disable their own account (see docs/admin.md). ' +
        'A disabled user is refused at login, not logged out immediately — see docs/security.md ' +
        '("The stateless-JWT trade-off").',
      security: cookieAuth,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      requestBody: jsonBody({ $ref: '#/components/schemas/SetUserActiveInput' }),
      responses: {
        '200': ok({ $ref: '#/components/schemas/SafeUser' }),
        '400': err('Attempting to disable the caller\'s own account.'),
        '403': err('The caller is authenticated but not an admin.'),
        '404': err('No user with this ID.'),
      },
    },
  },
  '/admin/audit-logs': {
    get: {
      tags: ['Admin'],
      summary: 'List audit log entries',
      description:
        'Requires the ADMIN role. Records admin actions taken on a resource that is not theirs (a ' +
        'disable/enable, a cross-user job cancel/retry) — see docs/admin.md ("Audit logging"). ' +
        '`userId` filters by the *acting* admin, never the target.',
      security: cookieAuth,
      parameters: [
        pageParam,
        limitParam,
        { name: 'userId', in: 'query', schema: { type: 'string', format: 'uuid' }, description: 'The acting admin.' },
        { name: 'action', in: 'query', schema: { type: 'string' }, example: 'ADMIN_JOB_CANCEL' },
        { name: 'resource', in: 'query', schema: { type: 'string' }, example: 'Job' },
        { name: 'resourceId', in: 'query', schema: { type: 'string' } },
        { name: 'fromDate', in: 'query', schema: { type: 'string', format: 'date-time' } },
        { name: 'toDate', in: 'query', schema: { type: 'string', format: 'date-time' } },
        { name: 'sortOrder', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' } },
      ],
      responses: {
        '200': paginatedOk({ $ref: '#/components/schemas/AuditLog' }),
        '403': err('The caller is authenticated but not an admin.'),
      },
    },
  },
  '/notifications': {
    get: {
      tags: ['Notifications'],
      summary: "List the caller's own notifications",
      security: cookieAuth,
      parameters: [
        pageParam,
        limitParam,
        { name: 'unreadOnly', in: 'query', schema: { type: 'boolean' } },
      ],
      responses: {
        '200': ok(
          { type: 'array', items: { $ref: '#/components/schemas/Notification' } },
          {
            unreadCount: { type: 'integer', description: 'The true unread count, independent of the current page.' },
            pagination: { $ref: '#/components/schemas/Pagination' },
          },
        ),
      },
    },
  },
  '/notifications/{id}/read': {
    patch: {
      tags: ['Notifications'],
      summary: 'Mark a notification as read',
      description: 'No admin override — a notification belongs strictly to the user it was created for. See docs/realtime.md.',
      security: cookieAuth,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: {
        '200': ok({ $ref: '#/components/schemas/Notification' }),
        '403': err('This notification belongs to another user.'),
        '404': err('No notification with this ID.'),
      },
    },
  },
  '/schedules': {
    post: {
      tags: ['Schedules'],
      summary: 'Create a schedule',
      security: cookieAuth,
      requestBody: jsonBody({ $ref: '#/components/schemas/CreateScheduleInput' }),
      responses: {
        '201': ok({ $ref: '#/components/schemas/Schedule' }),
        '400': err('Invalid cron expression, or the payload is invalid for the given jobType.'),
      },
    },
    get: {
      tags: ['Schedules'],
      summary: "List the caller's own schedules",
      security: cookieAuth,
      parameters: [pageParam, limitParam],
      responses: { '200': paginatedOk({ $ref: '#/components/schemas/Schedule' }) },
    },
  },
  '/schedules/{id}': {
    get: {
      tags: ['Schedules'],
      summary: 'Get a schedule by ID',
      security: cookieAuth,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: {
        '200': ok({ $ref: '#/components/schemas/Schedule' }),
        '403': err('This schedule belongs to another user (no admin override — see docs/scheduling.md).'),
        '404': err('No schedule with this ID.'),
      },
    },
    patch: {
      tags: ['Schedules'],
      summary: 'Update a schedule',
      description: 'Every field optional. jobType cannot be changed — see docs/scheduling.md.',
      security: cookieAuth,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      requestBody: jsonBody({ $ref: '#/components/schemas/UpdateScheduleInput' }),
      responses: {
        '200': ok({ $ref: '#/components/schemas/Schedule' }),
        '403': err('This schedule belongs to another user.'),
        '404': err('No schedule with this ID.'),
      },
    },
    delete: {
      tags: ['Schedules'],
      summary: 'Delete a schedule',
      security: cookieAuth,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: {
        '200': messageOk,
        '403': err('This schedule belongs to another user.'),
        '404': err('No schedule with this ID.'),
      },
    },
  },
  '/dashboard/stats': {
    get: {
      tags: ['Dashboard'],
      summary: "The caller's own job statistics, last 14 days",
      description:
        'Cached per-user in Redis with a short TTL and invalidated on every real job-status change — ' +
        'see docs/security.md ("Caching").',
      security: cookieAuth,
      responses: { '200': ok({ $ref: '#/components/schemas/DashboardStats' }) },
    },
  },
  '/health': {
    get: {
      tags: ['Health'],
      summary: 'API, database, Redis, and worker liveness',
      description:
        'Not under /api/v1 and not rate limited — mounted ahead of the general API rate limiter for ' +
        'exactly that reason (monitoring systems are expected to poll it frequently). `worker` is ' +
        '"unknown", not "unhealthy", when Redis itself is unreachable — see docs/worker-system.md ' +
        '("Worker liveness").',
      security: [],
      responses: {
        '200': {
          description: 'Every component is healthy.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string', enum: ['healthy'] },
                  database: { type: 'string', enum: ['healthy'] },
                  redis: { type: 'string', enum: ['healthy'] },
                  worker: { type: 'string', enum: ['healthy', 'unhealthy', 'unknown'] },
                  workerLastHeartbeatAt: { type: 'string', format: 'date-time', nullable: true },
                },
              },
            },
          },
        },
        '503': {
          description: 'At least one component is unhealthy.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string', enum: ['unhealthy'] },
                  database: { type: 'string', enum: ['healthy', 'unhealthy'] },
                  redis: { type: 'string', enum: ['healthy', 'unhealthy'] },
                  worker: { type: 'string', enum: ['healthy', 'unhealthy', 'unknown'] },
                  workerLastHeartbeatAt: { type: 'string', format: 'date-time', nullable: true },
                },
              },
            },
          },
        },
      },
    },
  },
};
