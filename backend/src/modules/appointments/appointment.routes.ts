import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { requirePasswordChanged } from '../../middleware/require-password-changed.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './appointment.controller.js';
import {
  appointmentIdParamsSchema,
  appointmentReminderBodySchema,
  cancelAppointmentBodySchema,
  createAppointmentBodySchema,
  listAppointmentsQuerySchema,
  rescheduleAppointmentBodySchema,
  updateAppointmentBodySchema,
} from './appointment.validation.js';

export const appointmentsRouter = Router();

appointmentsRouter.use(authenticate, requirePasswordChanged);

appointmentsRouter.get(
  '/',
  authorize('appointments:read'),
  validate({ query: listAppointmentsQuerySchema }),
  (req, res, next) => {
    void controller.list(req, res).catch(next);
  },
);

appointmentsRouter.post(
  '/',
  authorize('appointments:create'),
  validate({ body: createAppointmentBodySchema }),
  (req, res, next) => {
    void controller.create(req, res).catch(next);
  },
);

appointmentsRouter.get(
  '/:id',
  authorize('appointments:read'),
  validate({ params: appointmentIdParamsSchema }),
  (req, res, next) => {
    void controller.get(req, res).catch(next);
  },
);

appointmentsRouter.patch(
  '/:id',
  authorize('appointments:update'),
  validate({ params: appointmentIdParamsSchema, body: updateAppointmentBodySchema }),
  (req, res, next) => {
    void controller.update(req, res).catch(next);
  },
);

appointmentsRouter.post(
  '/:id/cancel',
  authorize('appointments:cancel'),
  validate({ params: appointmentIdParamsSchema, body: cancelAppointmentBodySchema }),
  (req, res, next) => {
    void controller.cancel(req, res).catch(next);
  },
);

appointmentsRouter.post(
  '/:id/reschedule',
  authorize('appointments:update'),
  validate({ params: appointmentIdParamsSchema, body: rescheduleAppointmentBodySchema }),
  (req, res, next) => {
    void controller.reschedule(req, res).catch(next);
  },
);

appointmentsRouter.post(
  '/:id/reminders',
  authorize('appointments:update'),
  validate({ params: appointmentIdParamsSchema, body: appointmentReminderBodySchema }),
  (req, res, next) => {
    void controller.reminders(req, res).catch(next);
  },
);
