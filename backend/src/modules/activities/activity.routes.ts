import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { requirePasswordChanged } from '../../middleware/require-password-changed.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './activity.controller.js';
import {
  activityIdParamsSchema,
  createActivityBodySchema,
  listActivitiesQuerySchema,
} from './activity.validation.js';

export const activitiesRouter = Router();

activitiesRouter.use(authenticate, requirePasswordChanged);

activitiesRouter.get(
  '/',
  authorize('activities:read'),
  validate({ query: listActivitiesQuerySchema }),
  (req, res, next) => {
    void controller.list(req, res).catch(next);
  },
);

activitiesRouter.post(
  '/',
  authorize('activities:create'),
  validate({ body: createActivityBodySchema }),
  (req, res, next) => {
    void controller.create(req, res).catch(next);
  },
);

activitiesRouter.post(
  '/:id/complete',
  authorize('activities:complete'),
  validate({ params: activityIdParamsSchema }),
  (req, res, next) => {
    void controller.complete(req, res).catch(next);
  },
);