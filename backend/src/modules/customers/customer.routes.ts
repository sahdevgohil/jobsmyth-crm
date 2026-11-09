import { Router } from 'express';
import type { z } from 'zod';
import { authenticate, requireAuth } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { requirePasswordChanged } from '../../middleware/require-password-changed.js';
import { getValidatedQuery, validate } from '../../middleware/validate.js';
import { searchProperties } from './customer.service.js';
import * as controller from './customer.controller.js';
import {
  createCustomerBodySchema,
  createPropertyBodySchema,
  customerIdParamsSchema,
  duplicateCheckBodySchema,
  listCustomersQuerySchema,
  listPropertiesQuerySchema,
  propertyIdParamsSchema,
  updateCustomerBodySchema,
  updatePropertyBodySchema,
} from './customer.validation.js';

export const customersRouter = Router();
export const propertiesRouter = Router();

customersRouter.use(authenticate, requirePasswordChanged);
propertiesRouter.use(authenticate, requirePasswordChanged);

customersRouter.get(
  '/',
  authorize('customers:read'),
  validate({ query: listCustomersQuerySchema }),
  (req, res, next) => {
    void controller.list(req, res).catch(next);
  },
);

customersRouter.post(
  '/duplicate-check',
  authorize('customers:create'),
  validate({ body: duplicateCheckBodySchema }),
  (req, res, next) => {
    void controller.duplicateCheck(req, res).catch(next);
  },
);

customersRouter.post(
  '/',
  authorize('customers:create'),
  validate({ body: createCustomerBodySchema }),
  (req, res, next) => {
    void controller.create(req, res).catch(next);
  },
);

customersRouter.get(
  '/:id',
  authorize('customers:read'),
  validate({ params: customerIdParamsSchema }),
  (req, res, next) => {
    void controller.get(req, res).catch(next);
  },
);

customersRouter.patch(
  '/:id',
  authorize('customers:update'),
  validate({ params: customerIdParamsSchema, body: updateCustomerBodySchema }),
  (req, res, next) => {
    void controller.update(req, res).catch(next);
  },
);

customersRouter.post(
  '/:id/archive',
  authorize('customers:archive'),
  validate({ params: customerIdParamsSchema }),
  (req, res, next) => {
    void controller.archive(req, res).catch(next);
  },
);

customersRouter.delete(
  '/:id',
  authorize('customers:delete'),
  validate({ params: customerIdParamsSchema }),
  (req, res, next) => {
    void controller.remove(req, res).catch(next);
  },
);

customersRouter.get(
  '/:id/summary',
  authorize('customers:read'),
  validate({ params: customerIdParamsSchema }),
  (req, res, next) => {
    void controller.summary(req, res).catch(next);
  },
);

customersRouter.get(
  '/:id/properties',
  authorize('properties:read'),
  validate({ params: customerIdParamsSchema }),
  (req, res, next) => {
    void controller.listProperties(req, res).catch(next);
  },
);

customersRouter.post(
  '/:id/properties',
  authorize('properties:create'),
  validate({ params: customerIdParamsSchema, body: createPropertyBodySchema }),
  (req, res, next) => {
    void controller.createProperty(req, res).catch(next);
  },
);

propertiesRouter.get(
  '/',
  authorize('properties:read'),
  validate({ query: listPropertiesQuerySchema }),
  (req, res, next) => {
    void (async () => {
      const auth = requireAuth(req);
      const q = getValidatedQuery<z.infer<typeof listPropertiesQuerySchema>>(req);
      res.status(200).json(
        await searchProperties({ auth: { userId: auth.userId, role: auth.role }, ...q }),
      );
    })().catch(next);
  },
);

propertiesRouter.get(
  '/:id',
  authorize('properties:read'),
  validate({ params: propertyIdParamsSchema }),
  (req, res, next) => {
    void controller.getProperty(req, res).catch(next);
  },
);

propertiesRouter.patch(
  '/:id',
  authorize('properties:update'),
  validate({ params: propertyIdParamsSchema, body: updatePropertyBodySchema }),
  (req, res, next) => {
    void controller.updateProperty(req, res).catch(next);
  },
);