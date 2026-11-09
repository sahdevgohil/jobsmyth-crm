import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../../middleware/authenticate.js';
import { authorize } from '../../../middleware/authorize.js';
import { solarRateLimiter } from '../../../middleware/rate-limit.js';
import { getValidatedBody, getValidatedParams, getValidatedQuery, validate } from '../../../middleware/validate.js';
import { getStorageAdapter } from '../../../services/storage/local-storage.adapter.js';
import { FileModel } from '../../files/file.model.js';
import { MATERIAL_BASES, PRODUCT_FAMILIES } from './materials.js';
import { GEOMETRY_EDGE_TYPES } from './geometry/types.js';
import { WASTE_PERCENTS } from './waste.js';
import { generateSolarReport, reportFilenameFor } from './solar.report.js';
import { contentDisposition } from './report/format.js';
import * as geo from './solar.geometry.service.js';
import * as service from './solar.service.js';
import { CORRECTABLE_FIELDS, type SolarCtx } from './solar.service.js';

export const solarRouter = Router();

function ctx(req: Request): SolarCtx {
  const a = requireAuth(req);
  return { userId: a.userId, role: a.role, companyId: a.companyId, permissions: a.permissions, requestId: req.requestId, ip: req.ip };
}
const h = (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction): void => {
  void fn(req, res).catch((e: unknown) => {
    try {
      next(service.toAppError(e));
    } catch (rethrown) {
      next(rethrown);
    }
  });
};

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const idParams = z.object({ id: objectId }).strict();

solarRouter.get('/status', authorize('measurements:read'), h(async (req, res) => {
  res.status(200).json({ data: await service.integrationState(ctx(req)) });
}));

solarRouter.get('/usage', authorize('measurements:manage'), h(async (req, res) => {
  res.status(200).json({ data: await service.getUsage(ctx(req)) });
}));

const kinds = (v: z.ZodTypeAny) => z.object({ building_insights: v, data_layers: v, geocode: v }).partial();
const settingsBody = z.object({
  enabled: z.boolean().optional(),
  preferredQuality: z.enum(['HIGH', 'MEDIUM', 'BASE']).optional(),
  allowBaseFallback: z.boolean().optional(),
  dailyLimit: kinds(z.number().int().min(0).max(100000)).optional(),
  monthlyFree: kinds(z.number().int().min(0)).optional(),
  warnPercent: z.number().int().min(1).max(100).optional(),
  allowOverage: z.boolean().optional(),
  pricePer1000Cents: kinds(z.number().min(0)).optional(),
  cacheDays: z.number().int().min(0).max(365).optional(),
  rawRetentionDays: z.number().int().min(0).max(365).optional(),
  includeImagery: z.boolean().optional(),
  recommendedPitchedWaste: z.number().int().min(0).max(30).optional(),
  recommendedFlatWaste: z.number().int().min(0).max(30).optional(),
  imageryRetentionDays: z.number().int().min(0).max(365).optional(),
  materialRules: z
    .array(
      z
        .object({
          key: z.string().trim().min(1).max(40),
          name: z.string().trim().min(1).max(80),
          packageUnit: z.string().trim().min(1).max(40),
          basis: z.enum(MATERIAL_BASES),
          countKey: z.string().trim().max(40).optional(),
          coveragePerPackage: z.number().positive().max(100000),
          useWaste: z.boolean(),
          enabled: z.boolean(),
          note: z.string().max(300),
        })
        .strict(),
    )
    .max(40)
    .optional(),
}).strict();

solarRouter.get('/settings', authorize('measurements:manage'), h(async (req, res) => {
  const s = await service.getSettings(ctx(req));
  const state = await service.integrationState(ctx(req));
  const plain = s.toObject() as unknown as Record<string, unknown>;
  delete plain._id;
  delete plain.companyId;
  delete plain.__v;
  res.status(200).json({ data: { ...plain, integration: state } }); // the API key is never part of this response
}));

solarRouter.put('/settings', authorize('measurements:manage'), validate({ body: settingsBody }), h(async (req, res) => {
  const body = getValidatedBody<z.infer<typeof settingsBody>>(req);
  const cur = (await service.getSettings(ctx(req))).toObject() as unknown as Record<string, Record<string, unknown>>;
  const merged: Record<string, unknown> = { ...body };
  for (const k of ['dailyLimit', 'monthlyFree', 'pricePer1000Cents'] as const) if (body[k]) merged[k] = { ...(cur[k] ?? {}), ...body[k] };
  await service.updateSettings(ctx(req), merged);
  res.status(200).json({ data: await service.integrationState(ctx(req)) });
}));

solarRouter.post('/test-connection', authorize('measurements:manage'), solarRateLimiter, h(async (req, res) => {
  res.status(200).json({ data: await service.testConnection(ctx(req)) });
}));

const searchQuery = z.object({ q: z.string().trim().min(3).max(200), geocode: z.enum(['true', 'false']).optional() }).strict();
solarRouter.get('/address-search', authorize('measurements:order'), solarRateLimiter, validate({ query: searchQuery }), h(async (req, res) => {
  const q = getValidatedQuery<z.infer<typeof searchQuery>>(req);
  res.status(200).json({ data: await service.searchAddress(ctx(req), q.q, q.geocode === 'true') });
}));

const runBody = z
  .object({
    propertyId: objectId.optional(),
    customerId: objectId.optional(),
    address: z.object({ line1: z.string().trim().min(3).max(200), city: z.string().trim().max(100).optional(), state: z.string().trim().max(50).optional(), zip: z.string().trim().min(3).max(12) }).strict().optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    confirmApproximate: z.boolean().optional(),
    force: z.boolean().optional(),
  })
  .strict()
  .refine((b) => b.propertyId || (b.customerId && b.address), { message: 'propertyId, or customerId with an address, is required' });

solarRouter.post('/run', authorize('measurements:order'), solarRateLimiter, validate({ body: runBody }), h(async (req, res) => {
  const r = await service.runMeasurement(ctx(req), getValidatedBody<z.infer<typeof runBody>>(req));
  res.status(r.cached ? 200 : 201).json({ data: r.measurement, meta: { cached: r.cached } });
}));

solarRouter.get('/property/:id/history', authorize('measurements:read'), validate({ params: idParams }), h(async (req, res) => {
  res.status(200).json({ data: await service.listHistory(ctx(req), getValidatedParams<{ id: string }>(req).id) });
}));

const fieldKey = z.enum(CORRECTABLE_FIELDS);
const correctionBody = z
  .object({
    changes: z.record(fieldKey, z.union([z.number(), z.string().max(2000), z.null()])).optional(),
    verify: z.record(fieldKey, z.boolean()).optional(),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
solarRouter.patch('/:id/corrections', authorize('measurements:update'), validate({ params: idParams, body: correctionBody }), h(async (req, res) => {
  const b = getValidatedBody<z.infer<typeof correctionBody>>(req);
  res.status(200).json({ data: await service.applyCorrections(ctx(req), getValidatedParams<{ id: string }>(req).id, b) });
}));

const productBody = z
  .object({
    family: z.enum(PRODUCT_FAMILIES),
    brand: z.string().trim().max(60).optional(),
    name: z.string().trim().min(1).max(120),
    packageUnit: z.string().trim().min(1).max(40),
    coveragePerPackage: z.number().positive().max(1_000_000),
    countKey: z.string().trim().max(40).optional(),
    enabled: z.boolean().optional(),
    specConfirmed: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
    notes: z.string().max(500).optional(),
  })
  .strict();
const productPatch = z.object({ brand: z.string().trim().max(60), name: z.string().trim().min(1).max(120), packageUnit: z.string().trim().min(1).max(40), coveragePerPackage: z.number().positive().max(1_000_000), countKey: z.string().trim().max(40), enabled: z.boolean(), specConfirmed: z.boolean(), sortOrder: z.number().int().min(0).max(10_000), notes: z.string().max(500) }).partial().strict();
solarRouter.get('/material-products', authorize('measurements:read'), h(async (req, res) => {
  res.status(200).json({ data: await geo.listProducts(ctx(req)) });
}));
solarRouter.post('/material-products', authorize('measurements:manage'), validate({ body: productBody }), h(async (req, res) => {
  res.status(201).json({ data: await geo.createProduct(ctx(req), getValidatedBody<z.infer<typeof productBody>>(req)) });
}));
solarRouter.patch('/material-products/:id', authorize('measurements:manage'), validate({ params: idParams, body: productPatch }), h(async (req, res) => {
  res.status(200).json({ data: await geo.updateProduct(ctx(req), getValidatedParams<{ id: string }>(req).id, getValidatedBody<z.infer<typeof productPatch>>(req)) });
}));
solarRouter.delete('/material-products/:id', authorize('measurements:manage'), validate({ params: idParams }), h(async (req, res) => {
  await geo.deleteProduct(ctx(req), getValidatedParams<{ id: string }>(req).id);
  res.status(204).end();
}));

solarRouter.get('/:id/estimate-inputs', authorize('measurements:read'), validate({ params: idParams }), h(async (req, res) => {
  const c = ctx(req);
  const id = getValidatedParams<{ id: string }>(req).id;
  const base = await service.getEstimateInputs(c, id);
  const doc = await service.loadMeasurement(c, id);
  const mats = await geo.getMaterials(c, id);
  res.status(200).json({ data: { ...base, selectedWastePercent: mats.wastePercent, summary: geo.summaryFor(doc), suggestedQuantities: geo.suggestedQuantities(doc), materials: mats.families, geometryStatus: (doc.geometry as { status?: string } | undefined)?.status ?? 'none' } });
}));

solarRouter.get('/:id/summary', authorize('measurements:read'), validate({ params: idParams }), h(async (req, res) => {
  res.status(200).json({ data: geo.summaryFor(await service.loadMeasurement(ctx(req), getValidatedParams<{ id: string }>(req).id)) });
}));

solarRouter.get('/:id/geometry', authorize('measurements:read'), validate({ params: idParams }), h(async (req, res) => {
  const doc = await service.loadMeasurement(ctx(req), getValidatedParams<{ id: string }>(req).id);
  res.status(200).json({ data: doc.geometry ?? null });
}));

solarRouter.get('/:id/diagrams', authorize('measurements:read'), validate({ params: idParams }), h(async (req, res) => {
  const doc = await service.loadMeasurement(ctx(req), getValidatedParams<{ id: string }>(req).id);
  res.status(200).json({ data: geo.buildDiagrams(doc) });
}));

solarRouter.get('/:id/aerial.png', authorize('measurements:read'), validate({ params: idParams }), h(async (req, res) => {
  const a = await geo.getAerial(ctx(req), getValidatedParams<{ id: string }>(req).id);
  res.status(200);
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(a.buffer);
}));

solarRouter.post('/:id/geometry/refresh', authorize('measurements:order'), solarRateLimiter, validate({ params: idParams }), h(async (req, res) => {
  res.status(200).json({ data: await geo.refreshGeometry(ctx(req), getValidatedParams<{ id: string }>(req).id) });
}));

const edgePatch = z
  .object({
    type: z.enum(GEOMETRY_EDGE_TYPES).optional(),
    lengthFt: z.number().min(0).max(5000).nullable().optional(),
    included: z.boolean().optional(),
    verification: z.enum(['unverified', 'needs_verification', 'verified']).optional(),
    note: z.string().max(500).optional(),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
const edgeId = z.string().regex(/^E\d{1,5}$/);
const edgeParams = z.object({ id: objectId, edgeId }).strict();
const edgeAdd = z.object({ type: z.enum(GEOMETRY_EDGE_TYPES), lengthFt: z.number().min(0).max(5000), note: z.string().max(500).optional(), reason: z.string().trim().min(3).max(500) }).strict();
const edgeVerify = z.object({ ids: z.array(edgeId).max(500).optional(), reason: z.string().trim().min(3).max(500) }).strict();

solarRouter.post('/:id/edges/verify', authorize('measurements:verify'), validate({ params: idParams, body: edgeVerify }), h(async (req, res) => {
  res.status(200).json({ data: await geo.verifyEdges(ctx(req), getValidatedParams<{ id: string }>(req).id, getValidatedBody<z.infer<typeof edgeVerify>>(req)) });
}));
solarRouter.post('/:id/edges', authorize('measurements:update'), validate({ params: idParams, body: edgeAdd }), h(async (req, res) => {
  res.status(201).json({ data: await geo.addEdge(ctx(req), getValidatedParams<{ id: string }>(req).id, getValidatedBody<z.infer<typeof edgeAdd>>(req)) });
}));
solarRouter.patch('/:id/edges/:edgeId', authorize('measurements:update'), validate({ params: edgeParams, body: edgePatch }), h(async (req, res) => {
  const p = getValidatedParams<{ id: string; edgeId: string }>(req);
  res.status(200).json({ data: await geo.patchEdge(ctx(req), p.id, p.edgeId, getValidatedBody<z.infer<typeof edgePatch>>(req)) });
}));

const wasteOk = z.number().refine((n) => (WASTE_PERCENTS as readonly number[]).includes(n), { message: 'Unsupported waste percentage' });
const wasteBody = z.object({ percent: wasteOk.optional(), flatPercent: wasteOk.optional() }).strict().refine((b) => b.percent !== undefined || b.flatPercent !== undefined, { message: 'percent or flatPercent is required' });
solarRouter.patch('/:id/waste', authorize('measurements:update'), validate({ params: idParams, body: wasteBody }), h(async (req, res) => {
  res.status(200).json({ data: await geo.setWaste(ctx(req), getValidatedParams<{ id: string }>(req).id, getValidatedBody<z.infer<typeof wasteBody>>(req)) });
}));

const materialsQuery = z.object({ waste: z.coerce.number().int().min(0).max(30).optional() }).strict();
solarRouter.get('/:id/materials', authorize('measurements:read'), validate({ params: idParams, query: materialsQuery }), h(async (req, res) => {
  res.status(200).json({ data: await geo.getMaterials(ctx(req), getValidatedParams<{ id: string }>(req).id, getValidatedQuery<z.infer<typeof materialsQuery>>(req).waste) });
}));

const photoBody = z
  .object({
    filename: z.string().trim().min(1).max(200),
    mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    contentBase64: z.string().min(8),
    category: z.enum(geo.PHOTO_CATEGORIES),
    relatedItem: z.string().trim().max(200).optional(),
    notes: z.string().trim().max(1000).optional(),
    capturedAt: z.string().datetime().optional(),
    gps: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).strict().optional(),
  })
  .strict();
const photoPatch = z.object({ category: z.enum(geo.PHOTO_CATEGORIES).optional(), relatedItem: z.string().trim().max(200).optional(), notes: z.string().trim().max(1000).optional(), verified: z.boolean().optional() }).strict();
solarRouter.get('/:id/photos', authorize('measurements:read'), validate({ params: idParams }), h(async (req, res) => {
  res.status(200).json({ data: await geo.listPhotos(ctx(req), getValidatedParams<{ id: string }>(req).id) });
}));
solarRouter.post('/:id/photos', authorize('measurements:update'), validate({ params: idParams, body: photoBody }), h(async (req, res) => {
  res.status(201).json({ data: await geo.addPhoto(ctx(req), getValidatedParams<{ id: string }>(req).id, getValidatedBody<z.infer<typeof photoBody>>(req)) });
}));
solarRouter.patch('/:id/photos/:fileId', authorize('measurements:update'), validate({ params: z.object({ id: objectId, fileId: objectId }).strict(), body: photoPatch }), h(async (req, res) => {
  const p = getValidatedParams<{ id: string; fileId: string }>(req);
  res.status(200).json({ data: await geo.patchPhoto(ctx(req), p.id, p.fileId, getValidatedBody<z.infer<typeof photoPatch>>(req)) });
}));

const reportQuery = z.object({ waste: z.coerce.number().int().min(0).max(30).optional(), flatWaste: z.coerce.number().int().min(0).max(30).optional(), regenerate: z.enum(['true', 'false']).optional(), inline: z.enum(['true', 'false']).optional() }).strict();
solarRouter.get('/:id/report', authorize('measurements:read'), validate({ params: idParams, query: reportQuery }), h(async (req, res) => {
  const c = ctx(req);
  const id = getValidatedParams<{ id: string }>(req).id;
  const q = getValidatedQuery<z.infer<typeof reportQuery>>(req);
  const m = await service.loadMeasurement(c, id);
  const filename = await reportFilenameFor(m);
  let buffer: Buffer | null = null;
  const existing = m.reportFileId ? await FileModel.findById(m.reportFileId) : null;
  // Reuse the stored PDF only if nothing changed since, no new waste was requested, and it already carries the current address-based name.
  if (existing && q.regenerate !== 'true' && q.waste === undefined && q.flatWaste === undefined && existing.createdAt >= m.updatedAt && existing.originalFilename === filename) {
    const obj = await getStorageAdapter().getObject(existing.storageKey);
    if (obj) {
      const parts: Buffer[] = [];
      for await (const part of obj.body) parts.push(part as Buffer);
      buffer = Buffer.concat(parts);
    }
  }
  if (!buffer) buffer = (await generateSolarReport(c, id, { wastePercent: q.waste, flatWastePercent: q.flatWaste })).buffer;
  res.status(200);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', contentDisposition(filename, q.inline === 'true' ? 'inline' : 'attachment'));
  res.setHeader('Cache-Control', 'no-store');
  res.send(buffer);
}));
