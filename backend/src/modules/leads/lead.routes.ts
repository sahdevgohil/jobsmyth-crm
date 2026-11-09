import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { requirePasswordChanged } from '../../middleware/require-password-changed.js';
import { websiteLeadRateLimiter } from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './lead.controller.js';
import {
  assignLeadBodySchema,
  changeStageBodySchema,
  convertLeadBodySchema,
  createLeadBodySchema,
  duplicateCheckBodySchema,
  leadIdParamsSchema,
  listLeadsQuerySchema,
  updateLeadBodySchema,
  websiteLeadBodySchema,
} from './lead.validation.js';

export const leadsRouter = Router();
export const publicWebsiteLeadsRouter = Router();

leadsRouter.use(authenticate, requirePasswordChanged);

leadsRouter.get(
  '/',
  authorize('leads:read'),
  validate({ query: listLeadsQuerySchema }),
  (req, res, next) => {
    void controller.list(req, res).catch(next);
  },
);

leadsRouter.post(
  '/duplicate-check',
  authorize('leads:create'),
  validate({ body: duplicateCheckBodySchema }),
  (req, res, next) => {
    void controller.duplicateCheck(req, res).catch(next);
  },
);

leadsRouter.post(
  '/',
  authorize('leads:create'),
  validate({ body: createLeadBodySchema }),
  (req, res, next) => {
    void controller.create(req, res).catch(next);
  },
);

leadsRouter.get(
  '/:id',
  authorize('leads:read'),
  validate({ params: leadIdParamsSchema }),
  (req, res, next) => {
    void controller.get(req, res).catch(next);
  },
);

leadsRouter.patch(
  '/:id',
  authorize('leads:update'),
  validate({ params: leadIdParamsSchema, body: updateLeadBodySchema }),
  (req, res, next) => {
    void controller.update(req, res).catch(next);
  },
);

leadsRouter.post(
  '/:id/stage',
  authorize('leads:update'),
  validate({ params: leadIdParamsSchema, body: changeStageBodySchema }),
  (req, res, next) => {
    void controller.changeStage(req, res).catch(next);
  },
);

leadsRouter.post(
  '/:id/assign',
  authorize('leads:assign'),
  validate({ params: leadIdParamsSchema, body: assignLeadBodySchema }),
  (req, res, next) => {
    void controller.assign(req, res).catch(next);
  },
);

leadsRouter.post(
  '/:id/convert',
  authorize('leads:convert'),
  validate({ params: leadIdParamsSchema, body: convertLeadBodySchema }),
  (req, res, next) => {
    void controller.convert(req, res).catch(next);
  },
);

publicWebsiteLeadsRouter.post(
  '/',
  websiteLeadRateLimiter,
  validate({ body: websiteLeadBodySchema }),
  (req, res, next) => {
    void controller.websiteIntake(req, res).catch(next);
  },
);
