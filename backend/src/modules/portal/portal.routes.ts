import { CustomerAccountModel } from './customer-account.model.js';
import { CustomerModel } from '../customers/customer.model.js';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { authenticate, requireAuth } from '../../middleware/authenticate.js';
import {
  portalAuthenticate,
  requirePortal,
  requirePortalPasswordChanged,
} from '../../middleware/portal-authenticate.js';
import { authRateLimiter, authStrictRateLimiter } from '../../middleware/rate-limit.js';
import { requirePasswordChanged } from '../../middleware/require-password-changed.js';
import { validate, getValidatedParams } from '../../middleware/validate.js';
import { AppError } from '../../utils/errors.js';
import * as authController from './portal-auth.controller.js';
import * as data from './portal-data.service.js';
import {
  createPortalAccountBodySchema,
  portalChangePasswordBodySchema,
  portalForgotPasswordBodySchema,
  portalIdParamsSchema,
  portalLoginBodySchema,
  portalResetPasswordBodySchema,
} from './portal.validation.js';

function authorizePortalAccountCreate(req: Request, _res: Response, next: NextFunction): void {
  try {
    const auth = requireAuth(req);
    if (
      !auth.permissions.includes('portal:manage') &&
      !auth.permissions.includes('customers:update')
    ) {
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
}

export const portalAuthRouter = Router();
export const portalAccountsRouter = Router();
export const portalDataRouter = Router();

portalAuthRouter.post(
  '/login',
  authRateLimiter,
  validate({ body: portalLoginBodySchema }),
  (req, res, next) => {
    void authController.login(req, res).catch(next);
  },
);

portalAuthRouter.post('/refresh', authRateLimiter, (req, res, next) => {
  void authController.refresh(req, res).catch(next);
});

portalAuthRouter.post('/logout', (req, res, next) => {
  void authController.logout(req, res).catch(next);
});

portalAuthRouter.get(
  '/me',
  portalAuthenticate,
  requirePortalPasswordChanged,
  (req, res, next) => {
    void authController.me(req, res).catch(next);
  },
);

portalAuthRouter.post(
  '/password/change',
  portalAuthenticate,
  requirePortalPasswordChanged,
  validate({ body: portalChangePasswordBodySchema }),
  (req, res, next) => {
    void authController.changePassword(req, res).catch(next);
  },
);

portalAuthRouter.post(
  '/password/forgot',
  authStrictRateLimiter,
  validate({ body: portalForgotPasswordBodySchema }),
  (req, res, next) => {
    void authController.forgotPassword(req, res).catch(next);
  },
);

portalAuthRouter.post(
  '/password/reset',
  authStrictRateLimiter,
  validate({ body: portalResetPasswordBodySchema }),
  (req, res, next) => {
    void authController.resetPassword(req, res).catch(next);
  },
);

portalAccountsRouter.use(authenticate, requirePasswordChanged);
portalAccountsRouter.post(
  '/',
  authorizePortalAccountCreate,
  validate({ body: createPortalAccountBodySchema }),
  (req, res, next) => {
    void authController.createAccount(req, res).catch(next);
  },
);

portalAccountsRouter.get('/', (req, res, next) => {
  void (async () => {
    const auth = requireAuth(req);
    if (!auth.permissions.includes('portal:manage') && !auth.permissions.includes('customers:read')) {
      throw new AppError({ status: 403, code: 'FORBIDDEN', message: 'You do not have permission to view portal accounts.' });
    }
    const customerId = String(req.query.customerId ?? '');
    if (!/^[a-f\d]{24}$/i.test(customerId)) {
      throw new AppError({ status: 400, code: 'VALIDATION_ERROR', message: 'customerId is required.' });
    }
    // Salespeople may only see portal status for customers they own.
    if (auth.role !== 'admin') {
      const owned = await CustomerModel.exists({ _id: customerId, ownerId: auth.userId });
      if (!owned) throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Customer not found.' });
    }
    const account = await CustomerAccountModel.findOne({ customerId }).select({ passwordHash: 0 });
    res.status(200).json({
      data: account
        ? {
            exists: true,
            email: account.email,
            isActive: account.isActive,
            mustChangePassword: account.mustChangePassword,
            lastLoginAt: account.lastLoginAt ? account.lastLoginAt.toISOString() : null,
          }
        : { exists: false },
    });
  })().catch(next);
});

portalDataRouter.use(portalAuthenticate, requirePortalPasswordChanged);

function scoped(handler: (customerId: string, req: import('express').Request) => Promise<unknown>) {
  return (req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => {
    void (async () => {
      const portal = requirePortal(req);
      const dataResult = await handler(portal.customerId, req);
      res.status(200).json({ data: dataResult });
    })().catch(next);
  };
}

portalDataRouter.get(
  '/proposals',
  scoped((customerId) => data.listProposals(customerId)),
);
portalDataRouter.get(
  '/proposals/:id',
  validate({ params: portalIdParamsSchema }),
  scoped((customerId, req) => {
    const params = getValidatedParams<{ id: string }>(req);
    return data.getProposal(customerId, params.id);
  }),
);

portalDataRouter.get(
  '/projects',
  scoped((customerId) => data.listProjects(customerId)),
);
portalDataRouter.get(
  '/projects/:id',
  validate({ params: portalIdParamsSchema }),
  scoped((customerId, req) => {
    const params = getValidatedParams<{ id: string }>(req);
    return data.getProject(customerId, params.id);
  }),
);

portalDataRouter.get(
  '/invoices',
  scoped((customerId) => data.listInvoices(customerId)),
);
portalDataRouter.get(
  '/invoices/:id',
  validate({ params: portalIdParamsSchema }),
  scoped((customerId, req) => {
    const params = getValidatedParams<{ id: string }>(req);
    return data.getInvoice(customerId, params.id);
  }),
);

portalDataRouter.get(
  '/files',
  scoped((customerId) => data.listFiles(customerId)),
);

portalDataRouter.get(
  '/inspections',
  scoped((customerId) => data.listInspections(customerId)),
);

portalDataRouter.get(
  '/communications',
  scoped((customerId) => data.listCommunications(customerId)),
);

portalDataRouter.get(
  '/after-sales',
  scoped((customerId) => data.listAfterSales(customerId)),
);
