import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireAuth } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { requirePasswordChanged } from '../../middleware/require-password-changed.js';
import { validate, getValidatedQuery } from '../../middleware/validate.js';
import { getDashboard } from './dashboard.service.js';
import {
  getFinanceAnalytics,
  getOperationsAnalytics,
  getSalesAnalytics,
} from './analytics.service.js';

const rangeQuerySchema = z
  .object({
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  })
  .strict();

function parseRange(query: z.infer<typeof rangeQuerySchema>): { from: Date; to: Date } {
  const now = new Date();
  const from = query.from
    ? new Date(query.from)
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = query.to ? new Date(query.to) : now;
  return { from, to };
}

export const analyticsRouter = Router();

analyticsRouter.use(authenticate, requirePasswordChanged);

analyticsRouter.get(
  '/dashboard',
  authorize('analytics:dashboard'),
  validate({ query: rangeQuerySchema }),
  (req, res, next) => {
    void (async () => {
      const auth = requireAuth(req);
      const query = getValidatedQuery<z.infer<typeof rangeQuerySchema>>(req);
      const { from, to } = parseRange(query);
      const data = await getDashboard({
        auth: { userId: auth.userId, role: auth.role },
        from,
        to,
      });
      res.status(200).json({ data });
    })().catch(next);
  },
);

analyticsRouter.get(
  '/sales',
  authorize('analytics:dashboard'),
  validate({ query: rangeQuerySchema }),
  (req, res, next) => {
    void (async () => {
      const auth = requireAuth(req);
      const query = getValidatedQuery<z.infer<typeof rangeQuerySchema>>(req);
      const { from, to } = parseRange(query);
      const data = await getSalesAnalytics({
        auth: { userId: auth.userId, role: auth.role },
        from,
        to,
      });
      res.status(200).json({ data });
    })().catch(next);
  },
);

analyticsRouter.get(
  '/operations',
  authorize('analytics:dashboard'),
  validate({ query: rangeQuerySchema }),
  (req, res, next) => {
    void (async () => {
      const auth = requireAuth(req);
      const query = getValidatedQuery<z.infer<typeof rangeQuerySchema>>(req);
      const { from, to } = parseRange(query);
      const data = await getOperationsAnalytics({
        auth: { userId: auth.userId, role: auth.role },
        from,
        to,
      });
      res.status(200).json({ data });
    })().catch(next);
  },
);

analyticsRouter.get(
  '/finance',
  authorize('analytics:dashboard'),
  validate({ query: rangeQuerySchema }),
  (req, res, next) => {
    void (async () => {
      const auth = requireAuth(req);
      const query = getValidatedQuery<z.infer<typeof rangeQuerySchema>>(req);
      const { from, to } = parseRange(query);
      const data = await getFinanceAnalytics({
        auth: { userId: auth.userId, role: auth.role },
        from,
        to,
      });
      res.status(200).json({ data });
    })().catch(next);
  },
);
