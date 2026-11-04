import type { NextFunction, Request, Response } from 'express';
import { permissionsForRole, type Role } from '../config/permissions.js';
import { verifyAccessToken } from '../modules/auth/jwt.js';
import { UserModel } from '../modules/users/user.model.js';
import { AppError } from '../utils/errors.js';

export async function authenticate(
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

    const claims = await verifyAccessToken(token);
    const user = await UserModel.findById(claims.sub).lean();
    if (!user || !user.isActive) {
      throw new AppError({
        status: 401,
        code: 'UNAUTHORIZED',
        message: 'Authentication required.',
      });
    }

    const role = user.role as Role;
    req.auth = {
      principalType: 'user',
      userId: user._id.toString(),
      role,
      email: user.email,
      permissions: permissionsForRole(role),
      mustChangePassword: user.mustChangePassword,
    };
    next();
  } catch (error) {
    next(error);
  }
}

export function requireAuth(req: Request): NonNullable<Request['auth']> {
  if (!req.auth) {
    throw new AppError({
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Authentication required.',
    });
  }
  return req.auth;
}
