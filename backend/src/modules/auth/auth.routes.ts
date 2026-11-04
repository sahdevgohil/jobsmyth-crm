import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { authRateLimiter, authStrictRateLimiter } from '../../middleware/rate-limit.js';
import { requirePasswordChanged } from '../../middleware/require-password-changed.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './auth.controller.js';
import {
  acceptInviteBodySchema,
  changePasswordBodySchema,
  forgotPasswordBodySchema,
  loginBodySchema,
  resetPasswordBodySchema,
} from './auth.validation.js';

export const authRouter = Router();

authRouter.post(
  '/login',
  authRateLimiter,
  validate({ body: loginBodySchema }),
  (req, res, next) => {
    void controller.login(req, res).catch(next);
  },
);

authRouter.post('/refresh', authRateLimiter, (req, res, next) => {
  void controller.refresh(req, res).catch(next);
});

authRouter.post('/logout', (req, res, next) => {
  void controller.logout(req, res).catch(next);
});

authRouter.get('/me', authenticate, requirePasswordChanged, (req, res, next) => {
  void controller.me(req, res).catch(next);
});

authRouter.post(
  '/password/change',
  authenticate,
  requirePasswordChanged,
  authorize('auth:change_password'),
  validate({ body: changePasswordBodySchema }),
  (req, res, next) => {
    void controller.changePassword(req, res).catch(next);
  },
);

authRouter.post(
  '/password/forgot',
  authStrictRateLimiter,
  validate({ body: forgotPasswordBodySchema }),
  (req, res, next) => {
    void controller.forgotPassword(req, res).catch(next);
  },
);

authRouter.post(
  '/password/reset',
  authStrictRateLimiter,
  validate({ body: resetPasswordBodySchema }),
  (req, res, next) => {
    void controller.resetPassword(req, res).catch(next);
  },
);

authRouter.post(
  '/invites/accept',
  authStrictRateLimiter,
  validate({ body: acceptInviteBodySchema }),
  (req, res, next) => {
    void controller.acceptInvite(req, res).catch(next);
  },
);
