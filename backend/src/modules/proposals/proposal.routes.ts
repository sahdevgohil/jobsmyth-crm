import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { requirePasswordChanged } from '../../middleware/require-password-changed.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './proposal.controller.js';
import {
  createProposalBodySchema,
  listProposalsQuerySchema,
  proposalIdParamsSchema,
  signatureRequestBodySchema,
  updateProposalBodySchema,
} from './proposal.validation.js';

export const proposalsRouter = Router();

proposalsRouter.use(authenticate, requirePasswordChanged);

proposalsRouter.get(
  '/',
  authorize('proposals:read'),
  validate({ query: listProposalsQuerySchema }),
  (req, res, next) => {
    void controller.list(req, res).catch(next);
  },
);

proposalsRouter.post(
  '/',
  authorize('proposals:create'),
  validate({ body: createProposalBodySchema }),
  (req, res, next) => {
    void controller.create(req, res).catch(next);
  },
);

proposalsRouter.get('/signatures/status', authorize('signatures:manage'), (req, res, next) => {
  void controller.signatureStatus(req, res).catch(next);
});

// Salespeople can also see that e-sign is not configured (honest UI).
proposalsRouter.get('/signature-providers', authorize('proposals:read'), (req, res, next) => {
  void controller.signatureStatus(req, res).catch(next);
});

proposalsRouter.get(
  '/:id',
  authorize('proposals:read'),
  validate({ params: proposalIdParamsSchema }),
  (req, res, next) => {
    void controller.get(req, res).catch(next);
  },
);

proposalsRouter.get(
  '/:id/preview',
  authorize('proposals:read'),
  validate({ params: proposalIdParamsSchema }),
  (req, res, next) => {
    void controller.preview(req, res).catch(next);
  },
);

proposalsRouter.patch(
  '/:id',
  authorize('proposals:update'),
  validate({ params: proposalIdParamsSchema, body: updateProposalBodySchema }),
  (req, res, next) => {
    void controller.update(req, res).catch(next);
  },
);

proposalsRouter.post(
  '/:id/send',
  authorize('proposals:send'),
  validate({ params: proposalIdParamsSchema }),
  (req, res, next) => {
    void controller.send(req, res).catch(next);
  },
);

proposalsRouter.post(
  '/:id/accept',
  authorize('proposals:update'),
  validate({ params: proposalIdParamsSchema }),
  (req, res, next) => {
    void controller.accept(req, res).catch(next);
  },
);

proposalsRouter.post(
  '/:id/reject',
  authorize('proposals:update'),
  validate({ params: proposalIdParamsSchema }),
  (req, res, next) => {
    void controller.reject(req, res).catch(next);
  },
);

proposalsRouter.post(
  '/:id/signature-request',
  authorize('proposals:send'),
  validate({ params: proposalIdParamsSchema, body: signatureRequestBodySchema }),
  (req, res, next) => {
    void controller.signatureRequest(req, res).catch(next);
  },
);

proposalsRouter.post(
  '/:id/duplicate',
  authorize('proposals:create'),
  validate({ params: proposalIdParamsSchema }),
  (req, res, next) => {
    void controller.duplicate(req, res).catch(next);
  },
);
