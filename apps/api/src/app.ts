import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env';
import { requestLogger } from './middleware/requestLogger';
import { errorHandler } from './middleware/errorHandler';
import { notFoundHandler } from './middleware/notFound';
import apiRoutes from './routes';
import healthRoutes from './routes/health.routes';

/**
 * Builds the Express app without starting a listener — src/index.ts calls
 * `.listen()` separately. Splitting these lets tests (tests/auth.test.ts)
 * import createApp() and hit it with supertest directly, with no real
 * port bound and no risk of port conflicts between test runs.
 */
export function createApp() {
  const app = express();

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

  app.use(healthRoutes);
  app.use('/api/v1', apiRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
