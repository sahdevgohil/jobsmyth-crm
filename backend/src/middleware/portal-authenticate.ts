import type { NextFunction, Request, Response } from 'express';
import { verifyPortalAccessToken } from '../modules/auth/jwt.js';
import { CustomerAccountModel } from '../modules/portal/customer-account.model.js';
import { AppError } from '../utils/errors.js';

export async function portalAuthenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ')) {
      throw new AppError({
        status: 401,
        code: 'UNAUTHORIZED',
        message: 'Authentication required.',
      });
    }
    const token = header.slice('Bearer '.length).trim();
    if (!token) {
      throw new AppError({
        status: 401,
        code: 'UNAUTHORIZED',
        message: 'Authentication required.',
      });
    }

    const claims = await verifyPortalAccessToken(token);
    const account = await CustomerAccountModel.findById(claims.sub).lean();
    if (!account || !account.isActive) {
      throw new AppError({
        status: 401,
        code: 'UNAUTHORIZED',
        message: 'Authentication required.',
      });
    }
    if (account.customerId.toString() !== claims.customerId) {
      throw new AppError({
        status: 401,
        code: 'UNAUTHORIZED',
        message: 'Authentication required.',
      });
    }

    req.portal = {
      principalType: 'customer',
      accountId: account._id.toString(),
      customerId: account.customerId.toString(),
      email: account.email,
      mustChangePassword: account.mustChangePassword,
    };
    next();
  } catch (error) {
    next(error);
  }
}

export function requirePortal(req: Request): NonNullable<Request['portal']> {
  if (!req.portal) {
    throw new AppError({
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Authentication required.',
    });
  }
  return req.portal;
}

const ALLOWED_WHILE_MUST_CHANGE = new Set([
  'GET /me',
  'POST /password/change',
  'POST /logout',
]);

export function requirePortalPasswordChanged(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  try {
    const portal = requirePortal(req);
    if (!portal.mustChangePassword) {
      next();
      return;
    }
    const key = `${req.method.toUpperCase()} ${req.path}`;
    const isAuthRouter = req.baseUrl.endsWith('/portal/auth');
    if (!(isAuthRouter && ALLOWED_WHILE_MUST_CHANGE.has(key))) {
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
