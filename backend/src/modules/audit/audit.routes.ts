import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { requirePasswordChanged } from '../../middleware/require-password-changed.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './audit.controller.js';
import { listAuditQuerySchema } from './audit.validation.js';

export const auditRouter = Router();

auditRouter.get(
  '/',
  authenticate,
  requirePasswordChanged,
  authorize('audit:read'),
  validate({ query: listAuditQuerySchema }),
  (req, res, next) => {
    void controller.list(req, res).catch(next);
  },
);
