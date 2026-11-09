import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { requirePasswordChanged } from '../../middleware/require-password-changed.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './communication.controller.js';
import {
  createEmailBodySchema,
  createInternalNoteBodySchema,
  createSmsBodySchema,
  listCommunicationsQuerySchema,
} from './communication.validation.js';

export const communicationsRouter = Router();

communicationsRouter.use(authenticate, requirePasswordChanged);

communicationsRouter.get(
  '/',
  authorize('communications:read'),
  validate({ query: listCommunicationsQuerySchema }),
  (req, res, next) => {
    void controller.list(req, res).catch(next);
  },
);

communicationsRouter.post(
  '/notes',
  authorize('communications:create'),
  validate({ body: createInternalNoteBodySchema }),
  (req, res, next) => {
    void controller.createNote(req, res).catch(next);
  },
);

communicationsRouter.post(
  '/email',
  authorize('communications:create'),
  validate({ body: createEmailBodySchema }),
  (req, res, next) => {
    void controller.createEmail(req, res).catch(next);
  },
);

communicationsRouter.post(
  '/sms',
  authorize('communications:create'),
  validate({ body: createSmsBodySchema }),
  (req, res, next) => {
    void controller.createSms(req, res).catch(next);
  },
);
