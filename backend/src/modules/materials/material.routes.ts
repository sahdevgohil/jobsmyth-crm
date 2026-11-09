import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { requirePasswordChanged } from '../../middleware/require-password-changed.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './material.controller.js';
import {
  createMaterialBodySchema,
  createMaterialRequirementBodySchema,
  listMaterialRequirementsQuerySchema,
  listMaterialsQuerySchema,
  materialIdParamsSchema,
  materialRequirementIdParamsSchema,
  updateMaterialBodySchema,
  updateMaterialRequirementBodySchema,
} from './material.validation.js';

export const materialsRouter = Router();
export const materialRequirementsRouter = Router();

materialsRouter.use(authenticate, requirePasswordChanged);
materialRequirementsRouter.use(authenticate, requirePasswordChanged);

materialsRouter.get(
  '/',
  authorize('materials:read'),
  validate({ query: listMaterialsQuerySchema }),
  (req, res, next) => {
    void controller.list(req, res).catch(next);
  },
);

materialsRouter.post(
  '/',
  authorize('materials:create'),
  validate({ body: createMaterialBodySchema }),
  (req, res, next) => {
    void controller.create(req, res).catch(next);
  },
);

materialsRouter.get(
  '/:id',
  authorize('materials:read'),
  validate({ params: materialIdParamsSchema }),
  (req, res, next) => {
    void controller.get(req, res).catch(next);
  },
);

materialsRouter.patch(
  '/:id',
  authorize('materials:update'),
  validate({ params: materialIdParamsSchema, body: updateMaterialBodySchema }),
  (req, res, next) => {
    void controller.update(req, res).catch(next);
  },
);

materialRequirementsRouter.get(
  '/',
  authorize('materials:read'),
  validate({ query: listMaterialRequirementsQuerySchema }),
  (req, res, next) => {
    void controller.listRequirements(req, res).catch(next);
  },
);

materialRequirementsRouter.post(
  '/',
  authorize('materials:create'),
  validate({ body: createMaterialRequirementBodySchema }),
  (req, res, next) => {
    void controller.createRequirement(req, res).catch(next);
  },
);

materialRequirementsRouter.patch(
  '/:id',
  authorize('materials:update'),
  validate({
    params: materialRequirementIdParamsSchema,
    body: updateMaterialRequirementBodySchema,
  }),
  (req, res, next) => {
    void controller.updateRequirement(req, res).catch(next);
  },
);
