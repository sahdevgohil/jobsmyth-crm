import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { requirePasswordChanged } from '../../middleware/require-password-changed.js';
import { validate } from '../../middleware/validate.js';
import { UserModel } from './user.model.js';
import * as controller from './user.controller.js';
import {
  createUserBodySchema,
  listUsersQuerySchema,
  updateUserBodySchema,
  userIdParamsSchema,
} from './user.validation.js';

export const usersRouter = Router();

usersRouter.use(authenticate, requirePasswordChanged);

/** Names-only directory of active staff, for assignee pickers and labels. No contact data or hashes. */
usersRouter.get('/directory', (_req, res, next) => {
  void (async () => {
    const rows = await UserModel.find({ isActive: true }).select({ firstName: 1, lastName: 1, role: 1 }).sort({ firstName: 1 }).lean();
    res.status(200).json({
      data: rows.map((u) => ({ id: String(u._id), firstName: u.firstName, lastName: u.lastName, role: u.role })),
    });
  })().catch(next);
});

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
