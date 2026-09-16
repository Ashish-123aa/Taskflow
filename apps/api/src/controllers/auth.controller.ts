import type { CookieOptions, Request, Response } from 'express';
import { registerSchema, loginSchema } from '@taskflow/shared';
import { authService } from '../services/auth.service';
import { asyncHandler } from '../utils/asyncHandler';
import { env } from '../config/env';
import { NotFoundError } from '../utils/errors';

const COOKIE_NAME = 'taskflow_token';

const cookieOptions: CookieOptions = {
  httpOnly: true, // invisible to JS — the main defense against XSS token theft
  secure: env.NODE_ENV === 'production', // HTTPS-only outside local dev
  sameSite: 'lax', // cross-site POSTs don't carry the cookie; normal nav does
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days, matches the default JWT_EXPIRES_IN
};

export const authController = {
  register: asyncHandler(async (req: Request, res: Response) => {
    const input = registerSchema.parse(req.body);
    const { user, token } = await authService.register(input);
    res.cookie(COOKIE_NAME, token, cookieOptions);
    res.status(201).json({ success: true, data: user });
  }),

  login: asyncHandler(async (req: Request, res: Response) => {
    const input = loginSchema.parse(req.body);
    const { user, token } = await authService.login(input);
    res.cookie(COOKIE_NAME, token, cookieOptions);
    res.status(200).json({ success: true, data: user });
  }),

  logout: asyncHandler(async (_req: Request, res: Response) => {
    // The JWT itself IS the session (no server-side session table), so
    // logout can only clear the cookie holding it, not revoke the token
    // server-side before it expires. See docs/security.md for the trade-off.
    res.clearCookie(COOKIE_NAME);
    res.status(200).json({ success: true, data: { message: 'Logged out' } });
  }),

  me: asyncHandler(async (req: Request, res: Response) => {
    const user = await authService.getById(req.user!.id);
    if (!user) {
      throw new NotFoundError('User');
    }
    res.status(200).json({ success: true, data: user });
  }),
};
