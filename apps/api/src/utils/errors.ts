/**
 * A small hierarchy of typed errors so a route/service can
 * `throw new NotFoundError('Job')` and the centralized error handler
 * (middleware/errorHandler.ts) knows exactly what HTTP status and
 * errorCode to send back — instead of every controller manually calling
 * res.status(...).json(...) and duplicating the response shape (section 29).
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly errorCode: string;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: number, errorCode: string, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.isOperational = isOperational;
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  public readonly details?: unknown;
  constructor(message: string, details?: unknown) {
    super(message, 400, 'VALIDATION_ERROR');
    this.details = details;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action') {
    super(message, 403, 'FORBIDDEN');
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    const code = `${resource.toUpperCase().replace(/\s+/g, '_')}_NOT_FOUND`;
    super(`${resource} not found`, 404, code);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, 'CONFLICT');
  }
}
