import { openApiSchemas } from './openapi.schemas';
import { openApiPaths } from './openapi.paths';

/**
 * A hand-maintained OpenAPI 3.0 document, not generated from the Zod
 * schemas or route files (see openapi.schemas.ts for why). Served via
 * swagger-ui-express, an existing dependency that was installed since
 * Phase 1's initial tech-stack setup but never actually mounted anywhere
 * — see app.ts for the (development-only) mount point.
 *
 * Every path here corresponds to a real route in routes/*.ts as of
 * Phase 11.1. Keeping this file in sync by hand, rather than generating
 * it, means a route change that forgets to update this file will not be
 * caught automatically — a real, ongoing cost, accepted for the same
 * reason `apps/web/src/lib/constants.ts` accepts an equivalent one (see
 * docs/frontend.md): avoiding a second dependency and a build step for a
 * spec this size.
 */
export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'TaskFlow API',
    version: '0.1.0',
    description:
      'Distributed job processing and automation platform. Authenticated users create, run, monitor, ' +
      'schedule, and retry background jobs without blocking the API server — see the top-level README ' +
      'and docs/architecture.md for the full design.\n\n' +
      'Authentication is a session cookie (`taskflow_token`, httpOnly), set by `/auth/register` or ' +
      '`/auth/login` and sent automatically by the browser on every subsequent request — there is no ' +
      'Authorization header to set by hand. "Try it out" in this UI works the same way a browser session ' +
      'does, as long as this page and the API share an origin (or CORS + credentials are configured to ' +
      'allow it).',
  },
  servers: [{ url: '/api/v1', description: 'All endpoints below are relative to this, except /health.' }],
  tags: [
    { name: 'Auth', description: 'Registration, login, logout, current session.' },
    { name: 'Jobs', description: "A user's own background jobs." },
    { name: 'Admin', description: 'Cross-user views and actions — requires the ADMIN role.' },
    { name: 'Notifications', description: 'In-app notifications for job completion/failure/dead-lettering.' },
    { name: 'Schedules', description: 'Cron-based recipes that create jobs on a timer.' },
    { name: 'Dashboard', description: "A user's own job statistics." },
    { name: 'Health', description: 'API, database, Redis, and worker liveness — not versioned under /api/v1.' },
  ],
  components: {
    securitySchemes: {
      cookieAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'taskflow_token',
        description:
          'An httpOnly session cookie issued by POST /auth/register or POST /auth/login. The browser ' +
          'attaches it automatically; there is nothing to set by hand on a real client. See ' +
          'docs/security.md ("Why the JWT lives in an httpOnly cookie, not localStorage").',
      },
    },
    schemas: openApiSchemas,
  },
  security: [{ cookieAuth: [] }],
  paths: openApiPaths,
};
