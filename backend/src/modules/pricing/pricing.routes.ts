import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireAuth } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { requirePasswordChanged } from '../../middleware/require-password-changed.js';
import { getValidatedBody, getValidatedParams, validate } from '../../middleware/validate.js';
import * as service from './pricing.service.js';
import type { PricingCtx } from './pricing.service.js';

export const pricingRouter = Router();
pricingRouter.use(authenticate, requirePasswordChanged);

const ctx = (req: Request): PricingCtx => {
  const a = requireAuth(req);
  return { userId: a.userId, companyId: a.companyId, role: a.role, permissions: a.permissions };
};
const wrap = (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction): void => {
  void fn(req, res).catch(next);
};

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const idParams = z.object({ id: z.string().min(1) }).strict();
const meta = (req: Request) => ({ requestId: req.requestId, ip: req.ip });

// ------------------------------------------------------------------ customer catalogs
pricingRouter.get('/catalogs', authorize('pricing:read'), wrap(async (req, res) => {
  res.status(200).json({ data: await service.listCatalogs(ctx(req)) });
}));
pricingRouter.post('/install-defaults', authorize('pricing:manage'), wrap(async (req, res) => {
  res.status(200).json({ data: await service.installDefaults(ctx(req)) });
}));
pricingRouter.get('/catalogs/:id', authorize('pricing:read'), validate({ params: idParams }), wrap(async (req, res) => {
  res.status(200).json({ data: await service.getCatalog(ctx(req), getValidatedParams<{ id: string }>(req).id) });
}));

const updateCatalogBody = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    validityDays: z.number().int().min(1).max(365).optional(),
    taxRateBps: z.number().int().min(0).max(10_000).nullable().optional(),
    effectiveFrom: z.string().datetime().nullable().optional(),
    packages: z.array(z.unknown()).max(10).optional(),
    items: z.array(z.unknown()).max(300).optional(),
    conditionalCharges: z.array(z.unknown()).max(100).optional(),
  })
  .strict();
pricingRouter.patch('/catalogs/:id', authorize('pricing:manage'), validate({ params: idParams, body: updateCatalogBody }), wrap(async (req, res) => {
  res.status(200).json({ data: await service.updateCatalog(ctx(req), getValidatedParams<{ id: string }>(req).id, getValidatedBody<z.infer<typeof updateCatalogBody>>(req), meta(req)) });
}));
pricingRouter.post('/catalogs/:id/approve', authorize('pricing:approve'), validate({ params: idParams }), wrap(async (req, res) => {
  res.status(200).json({ data: await service.approveCatalog(ctx(req), getValidatedParams<{ id: string }>(req).id, meta(req)) });
}));

// ------------------------------------------------------------------ quote + estimate
const quoteInput = z
  .object({
    package: z.enum(['good', 'better', 'best']),
    squares: z.number().positive().max(10_000),
    pitch: z.string().max(10).optional(),
    stories: z.number().int().min(1).max(10).optional(),
    extraLayers: z.number().int().min(0).max(5).optional(),
    quantities: z.record(z.string(), z.number().min(0).max(1_000_000)).optional(),
    osbSheets: z.number().min(0).max(10_000).optional(),
    plywoodSheets: z.number().min(0).max(10_000).optional(),
    reDeckSquares: z.number().min(0).max(10_000).optional(),
    permitCents: z.number().int().min(0).optional(),
    optionalItemKeys: z.array(z.string().max(64)).max(50).optional(),
    wasteBps: z.number().int().min(0).max(5_000).optional(),
    discountCents: z.number().int().min(0).optional(),
    taxRateBps: z.number().int().min(0).max(10_000).optional(),
  })
  .strict();
const quoteBody = z.object({ catalogId: objectId, input: quoteInput }).strict();
pricingRouter.post('/quote', authorize('pricing:read'), validate({ body: quoteBody }), wrap(async (req, res) => {
  const b = getValidatedBody<z.infer<typeof quoteBody>>(req);
  res.status(200).json({ data: await service.quote(ctx(req), b.catalogId, b.input as never) });
}));

const estimateBody = z
  .object({
    catalogId: objectId, customerId: objectId, propertyId: objectId,
    inspectionId: objectId.optional(), measurementId: objectId.optional(), leadId: objectId.optional(),
    notes: z.string().max(5_000).optional(), quote: quoteInput,
  })
  .strict();
pricingRouter.post('/estimates', authorize('estimates:create'), validate({ body: estimateBody }), wrap(async (req, res) => {
  const b = getValidatedBody<z.infer<typeof estimateBody>>(req);
  res.status(201).json({ data: await service.createEstimateFromQuote(ctx(req), { ...b, quote: b.quote as never, ...meta(req) }) });
}));

// ------------------------------------------------------------------ internal subcontractor rates and costs
pricingRouter.get('/rate-cards', authorize('costs:view'), wrap(async (req, res) => {
  res.status(200).json({ data: await service.listRateCards(ctx(req)) });
}));
pricingRouter.get('/rate-cards/:id', authorize('costs:view'), validate({ params: idParams }), wrap(async (req, res) => {
  res.status(200).json({ data: await service.getRateCard(ctx(req), getValidatedParams<{ id: string }>(req).id) });
}));
const createRateCardBody = z.object({ name: z.string().trim().min(1).max(200), subcontractorId: objectId.optional(), rates: z.array(z.unknown()).max(500), inclusionsNote: z.string().max(2000).optional(), source: z.string().max(500).optional() }).strict();
pricingRouter.post('/rate-cards', authorize('costs:manage'), validate({ body: createRateCardBody }), wrap(async (req, res) => {
  res.status(201).json({ data: await service.createRateCard(ctx(req), getValidatedBody<z.infer<typeof createRateCardBody>>(req)) });
}));
const updateRateCardBody = z.object({ name: z.string().trim().min(1).max(200).optional(), rates: z.array(z.unknown()).max(500).optional(), inclusionsNote: z.string().max(2000).optional(), effectiveFrom: z.string().datetime().nullable().optional() }).strict();
pricingRouter.patch('/rate-cards/:id', authorize('costs:manage'), validate({ params: idParams, body: updateRateCardBody }), wrap(async (req, res) => {
  res.status(200).json({ data: await service.updateRateCard(ctx(req), getValidatedParams<{ id: string }>(req).id, getValidatedBody<z.infer<typeof updateRateCardBody>>(req), meta(req)) });
}));
pricingRouter.post('/rate-cards/:id/approve', authorize('pricing:approve'), validate({ params: idParams }), wrap(async (req, res) => {
  res.status(200).json({ data: await service.approveRateCard(ctx(req), getValidatedParams<{ id: string }>(req).id, meta(req)) });
}));

pricingRouter.get('/estimates/:id/costs', authorize('costs:view'), validate({ params: idParams }), wrap(async (req, res) => {
  res.status(200).json({ data: await service.getCostSheet(ctx(req), getValidatedParams<{ id: string }>(req).id) });
}));
const costLines = z
  .object({
    lines: z.array(z.object({
      id: z.string().max(40).optional(),
      kind: z.enum(['subcontractor', 'material', 'other']),
      description: z.string().trim().max(500).optional(),
      unit: z.string().trim().max(20).optional(),
      quantity: z.number().min(0).max(10_000_000),
      unitCostCents: z.number().int().min(0).optional(),
      subcontractorId: objectId.optional(), rateCardId: objectId.optional(), rateKey: z.string().max(64).optional(),
      overridden: z.boolean().optional(), overrideReason: z.string().max(500).optional(),
    }).strict()).max(200),
  })
  .strict();
pricingRouter.put('/estimates/:id/costs', authorize('costs:manage'), validate({ params: idParams, body: costLines }), wrap(async (req, res) => {
  res.status(200).json({ data: await service.saveCostSheet(ctx(req), getValidatedParams<{ id: string }>(req).id, getValidatedBody<z.infer<typeof costLines>>(req).lines, meta(req)) });
}));
