import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { requirePasswordChanged } from '../../middleware/require-password-changed.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './inspection.controller.js';
import {
  createInspectionBodySchema,
  inspectionIdParamsSchema,
  listInspectionsQuerySchema,
  updateInspectionBodySchema,
} from './inspection.validation.js';

export const inspectionsRouter = Router();

inspectionsRouter.use(authenticate, requirePasswordChanged);

inspectionsRouter.get(
  '/',
  authorize('inspections:read'),
  validate({ query: listInspectionsQuerySchema }),
  (req, res, next) => {
    void controller.list(req, res).catch(next);
  },
);

inspectionsRouter.post(
  '/',
  authorize('inspections:create'),
  validate({ body: createInspectionBodySchema }),
  (req, res, next) => {
    void controller.create(req, res).catch(next);
  },
);

inspectionsRouter.get(
  '/:id',
  authorize('inspections:read'),
  validate({ params: inspectionIdParamsSchema }),
  (req, res, next) => {
    void controller.get(req, res).catch(next);
  },
);

inspectionsRouter.get(
  '/:id/report',
  authorize('inspections:read'),
  validate({ params: inspectionIdParamsSchema }),
  (req, res, next) => {
    void controller.report(req, res).catch(next);
  },
);

inspectionsRouter.patch(
  '/:id',
  authorize('inspections:update'),
  validate({ params: inspectionIdParamsSchema, body: updateInspectionBodySchema }),
  (req, res, next) => {
    void controller.update(req, res).catch(next);
  },
);

inspectionsRouter.post(
  '/:id/complete',
  authorize('inspections:update'),
  validate({ params: inspectionIdParamsSchema }),
  (req, res, next) => {
    void controller.complete(req, res).catch(next);
  },
);

inspectionsRouter.post(
  '/:id/cancel',
  authorize('inspections:update'),
  validate({ params: inspectionIdParamsSchema }),
  (req, res, next) => {
    void controller.cancel(req, res).catch(next);
  },
);
