import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireAuth } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { requirePasswordChanged } from '../../middleware/require-password-changed.js';
import {
  getValidatedBody,
  getValidatedParams,
  getValidatedQuery,
  validate,
} from '../../middleware/validate.js';
import { paginationQuerySchema } from '../../utils/pagination.js';
import * as service from './subcontractor.service.js';

const listQuery = paginationQuerySchema
  .extend({ search: z.string().optional(), active: z.enum(['true', 'false']).optional() })
  .strict();
const createBody = z
  .object({
    companyName: z.string().trim().min(1),
    contactName: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    address: z
      .object({
        line1: z.string().optional(),
        line2: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        zip: z.string().optional(),
      })
      .optional(),
    serviceCategories: z.array(z.string()).optional(),
    notes: z.string().optional(),
  })
  .strict();
const updateBody = createBody.partial().extend({ active: z.boolean().optional() }).strict();
const idParams = z.object({ id: z.string().min(1) }).strict();

export const subcontractorsRouter = Router();
subcontractorsRouter.use(authenticate, requirePasswordChanged);

subcontractorsRouter.get('/', authorize('subcontractors:read'), validate({ query: listQuery }), (req, res, next) => {
  void (async () => {
    const query = getValidatedQuery<z.infer<typeof listQuery>>(req);
    const result = await service.listSubcontractors({
      page: query.page,
      pageSize: query.pageSize,
      search: query.search,
      active: query.active === undefined ? undefined : query.active === 'true',
    });
    res.status(200).json(result);
  })().catch(next);
});

subcontractorsRouter.post('/', authorize('subcontractors:create'), validate({ body: createBody }), (req, res, next) => {
  void (async () => {
    const auth = requireAuth(req);
    const body = getValidatedBody<z.infer<typeof createBody>>(req);
    const data = await service.createSubcontractor({
      auth: { userId: auth.userId, role: auth.role },
      ...body,
      requestId: req.requestId,
      ip: req.ip,
    });
    res.status(201).json({ data });
  })().catch(next);
});

subcontractorsRouter.get('/:id', authorize('subcontractors:read'), validate({ params: idParams }), (req, res, next) => {
  void (async () => {
    const { id } = getValidatedParams<z.infer<typeof idParams>>(req);
    const data = await service.getSubcontractor(id);
    res.status(200).json({ data });
  })().catch(next);
});

subcontractorsRouter.patch(
  '/:id',
  authorize('subcontractors:update'),
  validate({ params: idParams, body: updateBody }),
  (req, res, next) => {
    void (async () => {
      const auth = requireAuth(req);
      const { id } = getValidatedParams<z.infer<typeof idParams>>(req);
      const body = getValidatedBody<z.infer<typeof updateBody>>(req);
      const data = await service.updateSubcontractor({
        auth: { userId: auth.userId, role: auth.role },
        id,
        patch: body,
        requestId: req.requestId,
        ip: req.ip,
      });
      res.status(200).json({ data });
    })().catch(next);
  },
);
