import type { NextFunction, Request, Response } from 'express';
import { permissionsForRole, type Role } from '../config/permissions.js';
import { verifyAccessToken } from '../modules/auth/jwt.js';
import { ensureDefaultCompany } from '../modules/companies/company.service.js';
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

    let companyId = user.companyId?.toString();
    if (!companyId) {
      // Pre-multi-company accounts belong to the default company; stamp it once.
      const company = await ensureDefaultCompany();
      companyId = company._id.toString();
      await UserModel.updateOne({ _id: user._id, companyId: { $exists: false } }, { $set: { companyId: company._id } });
    }
    const role = user.role as Role;
    req.auth = {
      principalType: 'user',
      userId: user._id.toString(),
      companyId,
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
