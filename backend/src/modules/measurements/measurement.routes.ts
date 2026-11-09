import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { requirePasswordChanged } from '../../middleware/require-password-changed.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './measurement.controller.js';
import { solarRouter } from './solar/solar.routes.js';
import {
  createMeasurementBodySchema,
  importMeasurementBodySchema,
  listMeasurementsQuerySchema,
  measurementIdParamsSchema,
  updateMeasurementBodySchema,
} from './measurement.validation.js';

export const measurementsRouter = Router();

measurementsRouter.use(authenticate, requirePasswordChanged);

measurementsRouter.get(
  '/',
  authorize('measurements:read'),
  validate({ query: listMeasurementsQuerySchema }),
  (req, res, next) => {
    void controller.list(req, res).catch(next);
  },
);

measurementsRouter.post(
  '/',
  authorize('measurements:create'),
  validate({ body: createMeasurementBodySchema }),
  (req, res, next) => {
    void controller.create(req, res).catch(next);
  },
);

// Static routes must be registered before '/:id'.
measurementsRouter.use('/solar', solarRouter);
measurementsRouter.post(
  '/import',
  authorize('measurements:create'),
  validate({ body: importMeasurementBodySchema }),
  (req, res, next) => {
    void controller.importRecord(req, res).catch(next);
  },
);

measurementsRouter.get('/integrations/status', authorize('measurements:read'), (req, res) => {
  controller.integrationStatus(req, res);
});

measurementsRouter.get(
  '/:id',
  authorize('measurements:read'),
  validate({ params: measurementIdParamsSchema }),
  (req, res, next) => {
    void controller.get(req, res).catch(next);
  },
);

measurementsRouter.patch(
  '/:id',
  authorize('measurements:update'),
  validate({ params: measurementIdParamsSchema, body: updateMeasurementBodySchema }),
  (req, res, next) => {
    void controller.update(req, res).catch(next);
  },
);
