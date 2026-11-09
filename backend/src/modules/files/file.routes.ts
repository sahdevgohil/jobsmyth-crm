import express, {
  Router,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import { getEnv } from '../../config/env.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { requirePasswordChanged } from '../../middleware/require-password-changed.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './file.controller.js';
import {
  fileIdParamsSchema,
  listFilesQuerySchema,
  uploadFileBodySchema,
} from './file.validation.js';

export const filesRouter = Router();

const FILES_JSON_LIMIT_MIN_BYTES = 12 * 1024 * 1024; // 12mb

/**
 * Base64 uploads exceed the global 1mb JSON limit, so app.ts skips the global parser for this
 * router and it parses its own (larger) bodies here — only after the caller is authenticated.
 * The limit covers FILE_MAX_BYTES expanded by base64 (4/3) plus envelope overhead, min 12mb.
 */
let jsonParser: RequestHandler | undefined;
function filesJsonParser(req: Request, res: Response, next: NextFunction): void {
  if (!jsonParser) {
    const base64Bytes = Math.ceil((getEnv().FILE_MAX_BYTES * 4) / 3) + 64 * 1024;
    jsonParser = express.json({ limit: Math.max(FILES_JSON_LIMIT_MIN_BYTES, base64Bytes) });
  }
  jsonParser(req, res, next);
}

filesRouter.use(authenticate, requirePasswordChanged, filesJsonParser);

filesRouter.get(
  '/',
  authorize('files:read'),
  validate({ query: listFilesQuerySchema }),
  (req, res, next) => {
    void controller.list(req, res).catch(next);
  },
);

filesRouter.post(
  '/',
  authorize('files:create'),
  validate({ body: uploadFileBodySchema }),
  (req, res, next) => {
    void controller.upload(req, res).catch(next);
  },
);

filesRouter.get(
  '/:id',
  authorize('files:read'),
  validate({ params: fileIdParamsSchema }),
  (req, res, next) => {
    void controller.get(req, res).catch(next);
  },
);

filesRouter.get(
  '/:id/download',
  authorize('files:read'),
  validate({ params: fileIdParamsSchema }),
  (req, res, next) => {
    void controller.download(req, res).catch(next);
  },
);

filesRouter.delete(
  '/:id',
  authorize('files:delete'),
  validate({ params: fileIdParamsSchema }),
  (req, res, next) => {
    void controller.remove(req, res).catch(next);
  },
);
