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
import { WORK_ORDER_STATUSES } from './work-order.model.js';
import * as service from './work-order.service.js';

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const listQuery = paginationQuerySchema
  .extend({
    projectId: objectId.optional(),
    status: z.enum(WORK_ORDER_STATUSES).optional(),
  })
  .strict();
const createBody = z
  .object({
    projectId: objectId,
    title: z.string().trim().min(1),
    description: z.string().optional(),
    instructions: z.string().optional(),
    location: z.string().optional(),
    subcontractorId: objectId.optional(),
    assignedEmployeeId: objectId.optional(),
    plannedStartAt: z.string().datetime({ offset: true }).optional(),
    plannedEndAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();
const updateBody = z
  .object({
    title: z.string().trim().min(1).optional(),
    description: z.string().optional(),
    instructions: z.string().optional(),
    location: z.string().optional(),
    subcontractorId: objectId.nullable().optional(),
    assignedEmployeeId: objectId.nullable().optional(),
    status: z.enum(WORK_ORDER_STATUSES).optional(),
    plannedStartAt: z.string().datetime({ offset: true }).nullable().optional(),
    plannedEndAt: z.string().datetime({ offset: true }).nullable().optional(),
    completionNotes: z.string().optional(),
    issues: z.string().optional(),
  })
  .strict();
const idParams = z.object({ id: z.string().min(1) }).strict();

export const workOrdersRouter = Router();
workOrdersRouter.use(authenticate, requirePasswordChanged);

workOrdersRouter.get('/', authorize('work_orders:read'), validate({ query: listQuery }), (req, res, next) => {
  void (async () => {
    const auth = requireAuth(req);
    const query = getValidatedQuery<z.infer<typeof listQuery>>(req);
    const result = await service.listWorkOrders({
      auth: { userId: auth.userId, role: auth.role },
      page: query.page,
      pageSize: query.pageSize,
      projectId: query.projectId,
      status: query.status,
    });
    res.status(200).json(result);
  })().catch(next);
});

workOrdersRouter.post('/', authorize('work_orders:create'), validate({ body: createBody }), (req, res, next) => {
  void (async () => {
    const auth = requireAuth(req);
    const body = getValidatedBody<z.infer<typeof createBody>>(req);
    const data = await service.createWorkOrder({
      auth: { userId: auth.userId, role: auth.role },
      ...body,
      requestId: req.requestId,
      ip: req.ip,
    });
    res.status(201).json({ data });
  })().catch(next);
});

workOrdersRouter.get('/:id', authorize('work_orders:read'), validate({ params: idParams }), (req, res, next) => {
  void (async () => {
    const auth = requireAuth(req);
    const { id } = getValidatedParams<z.infer<typeof idParams>>(req);
    const data = await service.getWorkOrder(id, { userId: auth.userId, role: auth.role });
    res.status(200).json({ data });
  })().catch(next);
});

workOrdersRouter.patch(
  '/:id',
  authorize('work_orders:update'),
  validate({ params: idParams, body: updateBody }),
  (req, res, next) => {
    void (async () => {
      const auth = requireAuth(req);
      const { id } = getValidatedParams<z.infer<typeof idParams>>(req);
      const body = getValidatedBody<z.infer<typeof updateBody>>(req);
      const data = await service.updateWorkOrder({
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
