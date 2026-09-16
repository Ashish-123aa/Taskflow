import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { logger } from '../config/logger';

/**
 * Attaches a unique requestId to every request so a single request's logs
 * — auth middleware, controller, error handler — can all be traced
 * together, and logs the method/path/status/duration once the response
 * finishes (section 28: requestId, userId are required log context).
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const requestId = randomUUID();
  res.locals.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  const start = Date.now();
  res.on('finish', () => {
    logger.info('HTTP request', {
      requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: Date.now() - start,
      userId: res.locals.userId,
    });
  });

  next();
}
