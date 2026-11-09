import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireAuth } from '../../middleware/authenticate.js';
import { requirePasswordChanged } from '../../middleware/require-password-changed.js';
import { getValidatedQuery, validate } from '../../middleware/validate.js';
import * as searchService from './search.service.js';

const querySchema = z
  .object({
    q: z.string().min(1),
    limit: z.coerce.number().int().positive().max(20).optional(),
  })
  .strict();

export const searchRouter = Router();
searchRouter.use(authenticate, requirePasswordChanged);

searchRouter.get('/', validate({ query: querySchema }), (req, res, next) => {
  void (async () => {
    const auth = requireAuth(req);
    const query = getValidatedQuery<z.infer<typeof querySchema>>(req);
    const data = await searchService.globalSearch({
      auth: { userId: auth.userId, role: auth.role },
      q: query.q,
      limit: query.limit,
    });
    res.status(200).json({ data });
  })().catch(next);
});
