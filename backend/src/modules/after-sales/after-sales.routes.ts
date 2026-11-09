import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { requirePasswordChanged } from '../../middleware/require-password-changed.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './after-sales.controller.js';
import {
  afterSalesIdParamsSchema,
  createAfterSalesBodySchema,
  listAfterSalesQuerySchema,
  updateAfterSalesBodySchema,
} from './after-sales.validation.js';

export const afterSalesRouter = Router();

afterSalesRouter.use(authenticate, requirePasswordChanged);

afterSalesRouter.get(
  '/',
  authorize('after_sales:read'),
  validate({ query: listAfterSalesQuerySchema }),
  (req, res, next) => {
    void controller.list(req, res).catch(next);
  },
);

afterSalesRouter.get(
  '/:id',
  authorize('after_sales:read'),
  validate({ params: afterSalesIdParamsSchema }),
  (req, res, next) => {
    void controller.getById(req, res).catch(next);
  },
);

afterSalesRouter.post(
  '/',
  authorize('after_sales:manage'),
  validate({ body: createAfterSalesBodySchema }),
  (req, res, next) => {
    void controller.create(req, res).catch(next);
  },
);

afterSalesRouter.patch(
  '/:id',
  authorize('after_sales:manage'),
  validate({ params: afterSalesIdParamsSchema, body: updateAfterSalesBodySchema }),
  (req, res, next) => {
    void controller.update(req, res).catch(next);
  },
);
