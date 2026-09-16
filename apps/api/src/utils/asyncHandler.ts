import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Express does not automatically forward a rejected promise from an async
 * handler to the error middleware — without this wrapper, a thrown error
 * inside `await someAsyncCall()` would either crash the process (in some
 * Express/Node versions) or hang the request with no response at all.
 * Every controller method is wrapped in this instead of using try/catch
 * everywhere.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
