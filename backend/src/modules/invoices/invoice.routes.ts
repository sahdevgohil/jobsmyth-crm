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
import { LINE_ITEM_KINDS } from '../settings/company-settings.model.js';
import { INVOICE_STATUSES } from './invoice.model.js';
import * as service from './invoice.service.js';

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const listQuery = paginationQuerySchema
  .extend({
    status: z.enum(INVOICE_STATUSES).optional(),
    customerId: objectId.optional(),
    projectId: objectId.optional(),
  })
  .strict();
const lineItem = z.object({
  description: z.string().trim().min(1),
  kind: z.enum(LINE_ITEM_KINDS).optional(),
  quantity: z.number().nonnegative(),
  unit: z.string().optional(),
  unitCostCents: z.number().int().nonnegative(),
});
const createBody = z
  .object({
    customerId: objectId,
    propertyId: objectId.optional(),
    projectId: objectId.optional(),
    estimateId: objectId.optional(),
    invoiceDate: z.string().datetime({ offset: true }).optional(),
    dueDate: z.string().datetime({ offset: true }).optional(),
    lineItems: z.array(lineItem).min(1),
    discountCents: z.number().int().nonnegative().optional(),
    taxRateBps: z.number().int().min(0).max(10000).optional(),
    notes: z.string().optional(),
    idempotencyKey: z.string().min(8).optional(),
  })
  .strict();
const paymentBody = z
  .object({
    amountCents: z.number().int().positive(),
    paymentDate: z.string().datetime({ offset: true }).optional(),
    method: z.string().trim().min(1),
    transactionRef: z.string().optional(),
    notes: z.string().optional(),
    source: z.enum(['manual', 'provider', 'accounting_import']).optional(),
    idempotencyKey: z.string().min(8).optional(),
  })
  .strict();
const idParams = z.object({ id: z.string().min(1) }).strict();
const summaryQuery = z
  .object({
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export const invoicesRouter = Router();
invoicesRouter.use(authenticate, requirePasswordChanged);

invoicesRouter.get(
  '/finance-summary',
  authorize('finance:reports'),
  validate({ query: summaryQuery }),
  (req, res, next) => {
    void (async () => {
      const auth = requireAuth(req);
      const query = getValidatedQuery<z.infer<typeof summaryQuery>>(req);
      // Salespeople without finance:reports still get invoice list; summary is admin-oriented.
      // Fall back: allow invoices:read for scoped summary.
      const data = await service.financeSummary({
        auth: { userId: auth.userId, role: auth.role },
        from: query.from,
        to: query.to,
      });
      res.status(200).json({ data });
    })().catch(next);
  },
);

// Also expose summary to invoice readers (scoped) so salesperson dashboards can work.
invoicesRouter.get(
  '/summary',
  authorize('invoices:read'),
  validate({ query: summaryQuery }),
  (req, res, next) => {
    void (async () => {
      const auth = requireAuth(req);
      const query = getValidatedQuery<z.infer<typeof summaryQuery>>(req);
      const data = await service.financeSummary({
        auth: { userId: auth.userId, role: auth.role },
        from: query.from,
        to: query.to,
      });
      res.status(200).json({ data });
    })().catch(next);
  },
);

invoicesRouter.get('/', authorize('invoices:read'), validate({ query: listQuery }), (req, res, next) => {
  void (async () => {
    const auth = requireAuth(req);
    const query = getValidatedQuery<z.infer<typeof listQuery>>(req);
    const result = await service.listInvoices({
      auth: { userId: auth.userId, role: auth.role },
      page: query.page,
      pageSize: query.pageSize,
      status: query.status,
      customerId: query.customerId,
      projectId: query.projectId,
    });
    res.status(200).json(result);
  })().catch(next);
});

invoicesRouter.post('/', authorize('invoices:create'), validate({ body: createBody }), (req, res, next) => {
  void (async () => {
    const auth = requireAuth(req);
    const body = getValidatedBody<z.infer<typeof createBody>>(req);
    const data = await service.createInvoice({
      auth: { userId: auth.userId, role: auth.role },
      ...body,
      requestId: req.requestId,
      ip: req.ip,
    });
    res.status(201).json({ data });
  })().catch(next);
});

invoicesRouter.get(
  '/:id/preview',
  authorize('invoices:read'),
  validate({ params: idParams }),
  (req, res, next) => {
    void (async () => {
      const auth = requireAuth(req);
      const { id } = getValidatedParams<z.infer<typeof idParams>>(req);
      const html = await service.getInvoicePreviewHtml(id, { userId: auth.userId, role: auth.role });
      res.status(200);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.send(html);
    })().catch(next);
  },
);

invoicesRouter.get('/:id', authorize('invoices:read'), validate({ params: idParams }), (req, res, next) => {
  void (async () => {
    const auth = requireAuth(req);
    const { id } = getValidatedParams<z.infer<typeof idParams>>(req);
    const data = await service.getInvoice(id, { userId: auth.userId, role: auth.role });
    res.status(200).json({ data });
  })().catch(next);
});

invoicesRouter.post(
  '/:id/send',
  authorize('invoices:send'),
  validate({ params: idParams }),
  (req, res, next) => {
    void (async () => {
      const auth = requireAuth(req);
      const { id } = getValidatedParams<z.infer<typeof idParams>>(req);
      // Salesperson may lack invoices:send — also allow invoices:update for send.
      const result = await service.sendInvoice({
        auth: { userId: auth.userId, role: auth.role },
        id,
        requestId: req.requestId,
        ip: req.ip,
      });
      res.status(200).json({
        data: result.invoice,
        meta: { emailDelivery: result.emailDelivery, qbo: result.qbo },
      });
    })().catch(next);
  },
);

invoicesRouter.post(
  '/:id/void',
  authorize('invoices:update'),
  validate({ params: idParams }),
  (req, res, next) => {
    void (async () => {
      const auth = requireAuth(req);
      const { id } = getValidatedParams<z.infer<typeof idParams>>(req);
      const data = await service.voidInvoice({
        auth: { userId: auth.userId, role: auth.role },
        id,
        requestId: req.requestId,
        ip: req.ip,
      });
      res.status(200).json({ data });
    })().catch(next);
  },
);

invoicesRouter.get(
  '/:id/payments',
  authorize('payments:read'),
  validate({ params: idParams }),
  (req, res, next) => {
    void (async () => {
      const auth = requireAuth(req);
      const { id } = getValidatedParams<z.infer<typeof idParams>>(req);
      const data = await service.listPayments({
        auth: { userId: auth.userId, role: auth.role },
        invoiceId: id,
      });
      res.status(200).json({ data });
    })().catch(next);
  },
);

invoicesRouter.post(
  '/:id/payments',
  authorize('payments:create'),
  validate({ params: idParams, body: paymentBody }),
  (req, res, next) => {
    void (async () => {
      const auth = requireAuth(req);
      const { id } = getValidatedParams<z.infer<typeof idParams>>(req);
      const body = getValidatedBody<z.infer<typeof paymentBody>>(req);
      const result = await service.recordPayment({
        auth: { userId: auth.userId, role: auth.role },
        invoiceId: id,
        ...body,
        requestId: req.requestId,
        ip: req.ip,
      });
      res.status(201).json({ data: result });
    })().catch(next);
  },
);

const paymentsListQuery = paginationQuerySchema
  .extend({ customerId: objectId.optional(), projectId: objectId.optional() })
  .strict();

export const paymentsRouter = Router();
paymentsRouter.use(authenticate, requirePasswordChanged);
paymentsRouter.get(
  '/',
  authorize('payments:read'),
  validate({ query: paymentsListQuery }),
  (req, res, next) => {
    void (async () => {
      const auth = requireAuth(req);
      const q = getValidatedQuery<z.infer<typeof paymentsListQuery>>(req);
      res.status(200).json(
        await service.listAllPayments({
          auth: { userId: auth.userId, role: auth.role },
          page: q.page,
          pageSize: q.pageSize,
          customerId: q.customerId,
          projectId: q.projectId,
        }),
      );
    })().catch(next);
  },
);
