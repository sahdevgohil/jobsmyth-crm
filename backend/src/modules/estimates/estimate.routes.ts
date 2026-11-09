import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { requirePasswordChanged } from '../../middleware/require-password-changed.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './estimate.controller.js';
import {
  denyEstimateBodySchema,
  reopenEstimateBodySchema,
  createEstimateBodySchema,
  duplicateEstimateBodySchema,
  estimateIdParamsSchema,
  listEstimatesQuerySchema,
  updateEstimateBodySchema,
} from './estimate.validation.js';

export const estimatesRouter = Router();

estimatesRouter.use(authenticate, requirePasswordChanged);

estimatesRouter.get(
  '/',
  authorize('estimates:read'),
  validate({ query: listEstimatesQuerySchema }),
  (req, res, next) => {
    void controller.list(req, res).catch(next);
  },
);

estimatesRouter.post(
  '/',
  authorize('estimates:create'),
  validate({ body: createEstimateBodySchema }),
  (req, res, next) => {
    void controller.create(req, res).catch(next);
  },
);

// Static routes must be registered before '/:id'.
estimatesRouter.get('/catalog', authorize('estimates:read'), (req, res, next) => {
  void controller.catalog(req, res).catch(next);
});

estimatesRouter.get(
  '/:id',
  authorize('estimates:read'),
  validate({ params: estimateIdParamsSchema }),
  (req, res, next) => {
    void controller.get(req, res).catch(next);
  },
);

estimatesRouter.get(
  '/:id/preview',
  authorize('estimates:read'),
  validate({ params: estimateIdParamsSchema }),
  (req, res, next) => {
    void controller.preview(req, res).catch(next);
  },
);

estimatesRouter.patch(
  '/:id',
  authorize('estimates:update'),
  validate({ params: estimateIdParamsSchema, body: updateEstimateBodySchema }),
  (req, res, next) => {
    void controller.update(req, res).catch(next);
  },
);

estimatesRouter.post(
  '/:id/duplicate',
  authorize('estimates:create'),
  validate({ params: estimateIdParamsSchema, body: duplicateEstimateBodySchema }),
  (req, res, next) => {
    void controller.duplicate(req, res).catch(next);
  },
);

estimatesRouter.post(
  '/:id/void',
  authorize('estimates:update'),
  validate({ params: estimateIdParamsSchema }),
  (req, res, next) => {
    void controller.voidOne(req, res).catch(next);
  },
);

estimatesRouter.post(
  '/:id/accept',
  authorize('estimates:update'),
  validate({ params: estimateIdParamsSchema }),
  (req, res, next) => {
    void controller.accept(req, res).catch(next);
  },
);

estimatesRouter.post(
  '/:id/deny',
  authorize('estimates:update'),
  validate({ params: estimateIdParamsSchema, body: denyEstimateBodySchema }),
  (req, res, next) => {
    void controller.deny(req, res).catch(next);
  },
);

estimatesRouter.post(
  '/:id/reopen',
  authorize('estimates:update'),
  validate({ params: estimateIdParamsSchema, body: reopenEstimateBodySchema }),
  (req, res, next) => {
    void controller.reopen(req, res).catch(next);
  },
);
