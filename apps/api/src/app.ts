import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env';
import { requestLogger } from './middleware/requestLogger';
import { errorHandler } from './middleware/errorHandler';
import { notFoundHandler } from './middleware/notFound';
import { apiRateLimiter } from './middleware/rateLimiters';
import { openApiSpec } from './docs/openapi';
import apiRoutes from './routes';
import healthRoutes from './routes/health.routes';

/**
 * Mounts the Swagger UI (section 31: "Expose documentation in
 * development") and the raw spec as JSON, for tools other than a
 * browser (Postman's "import from URL", codegen, etc). A no-op outside
 * development — the OpenAPI document isn't a secret, but this project
 * has no requirement to ship a documentation UI to production, and not
 * mounting it there is one less unauthenticated route to think about.
 *
 * Called *before* `helmet()` further down in `createApp` specifically
 * because helmet's default Content-Security-Policy blocks the inline
 * `<script>` swagger-ui-express's bundled HTML page uses to boot the UI
 * at all — a well-known interaction between the two packages. A static
 * documentation viewer doesn't carry the CSRF/XSS surface the real
 * JSON API needs helmet's defaults for, so this route skipping it
 * entirely is a narrowly-scoped trade-off, not a loosening of CSP for
 * the app as a whole (every other route still gets helmet's defaults,
 * unchanged).
 */
function mountApiDocs(app: express.Express): void {
  if (env.NODE_ENV === 'production') return;

  app.get('/api-docs.json', (_req, res) => res.json(openApiSpec));
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));
}

/**
 * Builds the Express app without starting a listener — src/index.ts calls
 * `.listen()` separately. Splitting these lets tests (tests/auth.test.ts)
 * import createApp() and hit it with supertest directly, with no real
 * port bound and no risk of port conflicts between test runs.
 */
export function createApp() {
  const app = express();

  mountApiDocs(app);

  app.use(helmet());
  app.use(
    cors({
      origin: env.CLIENT_URL,
      credentials: true, // required so the browser sends the httpOnly auth cookie
    }),
  );
  app.use(cookieParser());
  // Request size limit (section 27): caps JSON bodies so a route that was
  // never meant to receive a large payload can't be used to exhaust memory.
  app.use(express.json({ limit: '1mb' }));
  app.use(requestLogger);

  // Never rate limited — uptime/monitoring checks are expected to poll
  // this frequently, and it's mounted ahead of apiRateLimiter below
  // rather than under /api/v1 in the first place.
  app.use(healthRoutes);

  // The general "Normal API" budget (section 25: "100 requests / minute")
  // sits in front of every route under /api/v1, including the ones that
  // go on to apply a *stricter* limiter of their own (auth, job
  // creation) — the two are layered on purpose: this one is the coarse
  // outer ceiling against generic abuse, theirs is the narrower budget
  // for a specific sensitive action.
  app.use('/api/v1', apiRateLimiter, apiRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
