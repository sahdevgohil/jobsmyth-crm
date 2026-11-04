import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { requirePasswordChanged } from '../../middleware/require-password-changed.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './user.controller.js';
import {
  createUserBodySchema,
  listUsersQuerySchema,
  updateUserBodySchema,
  userIdParamsSchema,
} from './user.validation.js';

export const usersRouter = Router();

usersRouter.use(authenticate, requirePasswordChanged);

usersRouter.get(
  '/',
  authorize('users:manage'),
  validate({ query: listUsersQuerySchema }),
  (req, res, next) => {
    void controller.list(req, res).catch(next);
  },
);

usersRouter.get(
  '/:id',
  authorize('users:manage'),
  validate({ params: userIdParamsSchema }),
  (req, res, next) => {
    void controller.getById(req, res).catch(next);
  },
);

usersRouter.post(
  '/',
  authorize('users:manage'),
  validate({ body: createUserBodySchema }),
  (req, res, next) => {
    void controller.create(req, res).catch(next);
  },
);

usersRouter.patch(
  '/:id',
  authorize('users:manage'),
  validate({ params: userIdParamsSchema, body: updateUserBodySchema }),
  (req, res, next) => {
    void controller.update(req, res).catch(next);
  },
);

usersRouter.post(
  '/:id/deactivate',
  authorize('users:manage'),
  validate({ params: userIdParamsSchema }),
  (req, res, next) => {
    void controller.deactivate(req, res).catch(next);
  },
);
