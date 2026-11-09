import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { requirePasswordChanged } from '../../middleware/require-password-changed.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './notification.controller.js';
import {
  listNotificationsQuerySchema,
  notificationIdParamsSchema,
} from './notification.validation.js';

export const notificationsRouter = Router();

notificationsRouter.use(authenticate, requirePasswordChanged);

notificationsRouter.get(
  '/',
  authorize('notifications:read'),
  validate({ query: listNotificationsQuerySchema }),
  (req, res, next) => {
    void controller.list(req, res).catch(next);
  },
);

notificationsRouter.get('/unread-count', authorize('notifications:read'), (req, res, next) => {
  void controller.unread(req, res).catch(next);
});

notificationsRouter.post('/read-all', authorize('notifications:update'), (req, res, next) => {
  void controller.markAllRead(req, res).catch(next);
});

notificationsRouter.post(
  '/:id/read',
  authorize('notifications:update'),
  validate({ params: notificationIdParamsSchema }),
  (req, res, next) => {
    void controller.markRead(req, res).catch(next);
  },
);