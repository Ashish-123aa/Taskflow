import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import multer from 'multer';
import { AppError } from '../utils/errors';
import { env } from '../config/env';
import { logger } from '../config/logger';

interface ErrorResponseBody {
  success: false;
  message: string;
  errorCode: string;
  details?: unknown;
  stack?: string;
}

/**
 * Every error in the app — validation, auth, "not found", or a genuine bug —
 * funnels through here, so the response shape is always the same
 * (section 29) and the frontend never has to guess what kind of error it
 * got. Stack traces are only ever included outside production.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // Express identifies error-handling middleware by arity (4 params) —
  // `next` must stay in the signature even though it's unused here.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  const requestId = res.locals.requestId as string | undefined;

  if (err instanceof multer.MulterError) {
    const message =
      err.code === 'LIMIT_FILE_SIZE'
        ? `File exceeds the maximum allowed size (${env.MAX_UPLOAD_SIZE_MB}MB)`
        : err.message;
    logger.warn('Upload rejected', { requestId, code: err.code });
    res.status(400).json({ success: false, message, errorCode: 'UPLOAD_ERROR' });
    return;
  }

  if (err instanceof ZodError) {
    const body: ErrorResponseBody = {
      success: false,
      message: 'Validation failed',
      errorCode: 'VALIDATION_ERROR',
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    };
    logger.warn('Validation error', { requestId, path: req.path, details: body.details });
    res.status(400).json(body);
    return;
  }

  if (err instanceof AppError) {
    if (err.isOperational) {
      logger.warn(err.message, { requestId, errorCode: err.errorCode, path: req.path });
    } else {
      logger.error('Non-operational AppError', { requestId, path: req.path, error: err });
    }
    const body: ErrorResponseBody = {
      success: false,
      message: err.message,
      errorCode: err.errorCode,
    };
    if ('details' in err) {
      body.details = (err as unknown as { details?: unknown }).details;
    }
    res.status(err.statusCode).json(body);
    return;
  }

  // Anything else is unexpected — log it in full server-side, but never
  // leak internals (message, stack trace) to the client in production.
  logger.error('Unhandled error', { requestId, path: req.path, error: err });
  const body: ErrorResponseBody = {
    success: false,
    message:
      env.NODE_ENV === 'production'
        ? 'Internal server error'
        : ((err as Error)?.message ?? 'Internal server error'),
    errorCode: 'INTERNAL_SERVER_ERROR',
  };
  if (env.NODE_ENV !== 'production' && err instanceof Error) {
    body.stack = err.stack;
  }
  res.status(500).json(body);
}
