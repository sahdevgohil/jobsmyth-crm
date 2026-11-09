import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { requirePasswordChanged } from '../../middleware/require-password-changed.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './settings.controller.js';
import {
  createLookupBodySchema,
  createPipelineStageBodySchema,
  lookupIdParamsSchema,
  lookupTypeParamsSchema,
  patchCompanyBodySchema,
  patchPricingBodySchema,
  pipelineStageIdParamsSchema,
  reorderPipelineStagesBodySchema,
  updateLookupBodySchema,
  updatePipelineStageBodySchema,
} from './settings.validation.js';

export const settingsRouter = Router();

settingsRouter.use(authenticate, requirePasswordChanged);

settingsRouter.get('/company', authorize('settings:read'), (req, res, next) => {
  void controller.getCompany(req, res).catch(next);
});

settingsRouter.patch(
  '/company',
  authorize('settings:update'),
  validate({ body: patchCompanyBodySchema }),
  (req, res, next) => {
    void controller.patchCompany(req, res).catch(next);
  },
);

settingsRouter.get(
  '/lookups/:type',
  authorize('settings:read'),
  validate({ params: lookupTypeParamsSchema }),
  (req, res, next) => {
    void controller.listLookups(req, res).catch(next);
  },
);

settingsRouter.post(
  '/lookups/:type',
  authorize('settings:update'),
  validate({ params: lookupTypeParamsSchema, body: createLookupBodySchema }),
  (req, res, next) => {
    void controller.createLookup(req, res).catch(next);
  },
);

settingsRouter.patch(
  '/lookups/:type/:id',
  authorize('settings:update'),
  validate({ params: lookupIdParamsSchema, body: updateLookupBodySchema }),
  (req, res, next) => {
    void controller.updateLookup(req, res).catch(next);
  },
);

settingsRouter.get('/pipeline-stages', authorize('settings:read'), (req, res, next) => {
  void controller.listPipelineStages(req, res).catch(next);
});

settingsRouter.post(
  '/pipeline-stages',
  authorize('pipeline_stages:manage'),
  validate({ body: createPipelineStageBodySchema }),
  (req, res, next) => {
    void controller.createPipelineStage(req, res).catch(next);
  },
);

settingsRouter.post(
  '/pipeline-stages/reorder',
  authorize('pipeline_stages:manage'),
  validate({ body: reorderPipelineStagesBodySchema }),
  (req, res, next) => {
    void controller.reorderPipelineStages(req, res).catch(next);
  },
);

settingsRouter.patch(
  '/pipeline-stages/:id',
  authorize('pipeline_stages:manage'),
  validate({ params: pipelineStageIdParamsSchema, body: updatePipelineStageBodySchema }),
  (req, res, next) => {
    void controller.updatePipelineStage(req, res).catch(next);
  },
);

settingsRouter.get('/pricing', authorize('pricing:manage'), (req, res, next) => {
  void controller.getPricing(req, res).catch(next);
});

settingsRouter.patch(
  '/pricing',
  authorize('pricing:manage'),
  validate({ body: patchPricingBodySchema }),
  (req, res, next) => {
    void controller.patchPricing(req, res).catch(next);
  },
);
