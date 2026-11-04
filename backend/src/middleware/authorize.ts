import type { NextFunction, Request, Response } from 'express';
import type { Permission } from '../config/permissions.js';
import { AppError } from '../utils/errors.js';
import { requireAuth } from './authenticate.js';

export function authorize(permission: Permission) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const auth = requireAuth(req);
      if (!auth.permissions.includes(permission)) {
        req.log?.warn(
          {
            userId: auth.userId,
            permission,
            path: req.path,
            requestId: req.requestId,
          },
          'Forbidden permission attempt',
        );
        throw new AppError({
          status: 403,
          code: 'FORBIDDEN',
          message: 'You do not have permission to perform this action.',
        });
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
