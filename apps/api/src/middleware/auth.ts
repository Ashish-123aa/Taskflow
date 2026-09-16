import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@taskflow/shared';
import { verifyToken } from '../services/token.service';
import { UnauthorizedError, ForbiddenError } from '../utils/errors';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { id: string; role: Role };
    }
  }
}

/**
 * Verifies the JWT from the httpOnly cookie and attaches { id, role } to
 * req.user. This only checks "is there a valid, logged-in user" — it does
 * NOT check role. That's authorize()'s job, kept separate so a route can
 * require "any authenticated user" without also pinning a specific role.
 */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.taskflow_token as string | undefined;

  if (!token) {
    throw new UnauthorizedError('Authentication required');
  }

  try {
    const payload = verifyToken(token);
    req.user = { id: payload.sub, role: payload.role };
    res.locals.userId = payload.sub;
    next();
  } catch {
    throw new UnauthorizedError('Invalid or expired session');
  }
}

/**
 * RBAC (section 5): role checks happen here, on the backend, and nowhere
 * else — never inferred from anything the frontend claims about itself.
 * Usage: `router.get('/admin/x', authenticate, authorize('ADMIN'), handler)`.
 */
export function authorize(...allowedRoles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new UnauthorizedError('Authentication required');
    }
    if (!allowedRoles.includes(req.user.role)) {
      throw new ForbiddenError();
    }
    next();
  };
}
