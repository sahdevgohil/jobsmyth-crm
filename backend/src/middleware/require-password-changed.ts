import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/errors.js';
import { requireAuth } from './authenticate.js';

const ALLOWED_WHILE_MUST_CHANGE = new Set([
  'GET /me',
  'POST /password/change',
  'POST /logout',
]);

/**
 * AUTH-007 / V-02: users with mustChangePassword may only hit me, password change, and logout.
 * Mount on protected routers after authenticate (auth routes apply selectively).
 */
export function requirePasswordChanged(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  try {
    const auth = requireAuth(req);
    if (!auth.mustChangePassword) {
      next();
      return;
    }

    const key = `${req.method.toUpperCase()} ${req.path}`;
    // When mounted at /api/v1/auth, path is relative (e.g. /me). On other routers, block all.
    const isAuthRouter = req.baseUrl.endsWith('/auth');
    const allowed = isAuthRouter && ALLOWED_WHILE_MUST_CHANGE.has(key);

    if (!allowed) {
      throw new AppError({
        status: 403,
        code: 'PASSWORD_CHANGE_REQUIRED',
        message: 'You must change your password before continuing.',
      });
    }
    next();
  } catch (error) {
    next(error);
  }
}
