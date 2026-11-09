import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireAuth } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { requirePasswordChanged } from '../../middleware/require-password-changed.js';
import { getValidatedBody, getValidatedParams, getValidatedQuery, validate } from '../../middleware/validate.js';
import { PIPELINE_STAGES } from './pipeline.calc.js';
import * as service from './pipeline.service.js';
import type { JobFilters, PipelineAuth } from './pipeline.service.js';

export const pipelineRouter = Router();
pipelineRouter.use(authenticate, requirePasswordChanged);

const auth = (req: Request): PipelineAuth => {
  const a = requireAuth(req);
  return { userId: a.userId, role: a.role };
};
const h = (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction): void => {
  void fn(req, res).catch(next);
};

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const idParams = z.object({ id: objectId }).strict();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/, 'Use an ISO date.');

const filterShape = {
  from: day.optional(),
  to: day.optional(),
  salespersonId: objectId.optional(),
  projectManagerId: objectId.optional(),
  jobType: z.string().trim().max(60).optional(),
  paymentStatus: z.enum(['none', 'unpaid', 'partial', 'overdue', 'paid']).optional(),
  /** Report the pipeline as it stood at the end of this day. */
  asOf: day.optional(),
};
const summaryQuery = z.object(filterShape).strict();
const jobsQuery = z
  .object({
    ...filterShape,
    stage: z.enum([...PIPELINE_STAGES, 'denied']).optional(),
    search: z.string().trim().max(100).optional(),
    sort: z.enum(['stageDate', 'customer', 'value', 'outstanding', 'paid', 'number']).optional(),
    dir: z.enum(['asc', 'desc']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

const endOfDay = (s: string): Date => (s.length === 10 ? new Date(`${s}T23:59:59.999Z`) : new Date(s));
function filtersOf(q: z.infer<typeof summaryQuery>): { filters: JobFilters; asOf?: Date } {
  return {
    asOf: q.asOf ? endOfDay(q.asOf) : undefined,
    filters: {
      from: q.from ? new Date(q.from.length === 10 ? `${q.from}T00:00:00.000Z` : q.from) : undefined,
      to: q.to ? endOfDay(q.to) : undefined,
      salespersonId: q.salespersonId,
      projectManagerId: q.projectManagerId,
      jobType: q.jobType,
      paymentStatus: q.paymentStatus,
    },
  };
}

pipelineRouter.get('/summary', authorize('pipeline:read'), validate({ query: summaryQuery }), h(async (req, res) => {
  const { filters, asOf } = filtersOf(getValidatedQuery<z.infer<typeof summaryQuery>>(req));
  res.status(200).json({ data: await service.pipelineSummary({ auth: auth(req), filters, asOf }) });
}));

pipelineRouter.get('/jobs', authorize('pipeline:read'), validate({ query: jobsQuery }), h(async (req, res) => {
  const q = getValidatedQuery<z.infer<typeof jobsQuery>>(req);
  const { filters, asOf } = filtersOf(q);
  const r = await service.listPipelineJobs({ auth: auth(req), filters, asOf, query: { stage: q.stage, search: q.search, sort: q.sort, dir: q.dir, page: q.page, pageSize: q.pageSize } });
  res.status(200).json(r);
}));

pipelineRouter.get('/filter-options', authorize('pipeline:read'), h(async (req, res) => {
  const views = await service.jobViews({ auth: auth(req) });
  const uniq = (xs: Array<{ id: string; name: string } | null>) => [...new Map(xs.filter((x): x is { id: string; name: string } => Boolean(x)).map((x) => [x.id, x])).values()].sort((a, b) => a.name.localeCompare(b.name));
  res.status(200).json({ data: { salespeople: uniq(views.map((v) => v.salesperson)), projectManagers: uniq(views.map((v) => v.projectManager)), jobTypes: [...new Set(views.map((v) => v.jobType).filter(Boolean))].sort() } });
}));

pipelineRouter.get('/jobs/:id', authorize('pipeline:read'), validate({ params: idParams }), h(async (req, res) => {
  res.status(200).json({ data: await service.jobHistory(auth(req), getValidatedParams<{ id: string }>(req).id) });
}));

const moveBody = z.object({ toStage: z.enum(PIPELINE_STAGES), reason: z.string().trim().max(500).default('') }).strict();
pipelineRouter.post('/jobs/:id/move', authorize('pipeline:manage'), validate({ params: idParams, body: moveBody }), h(async (req, res) => {
  const b = getValidatedBody<z.infer<typeof moveBody>>(req);
  res.status(200).json({ data: await service.moveJob({ auth: auth(req), id: getValidatedParams<{ id: string }>(req).id, toStage: b.toStage, reason: b.reason, requestId: req.requestId, ip: req.ip }) });
}));

const changeOrderBody = z.object({ description: z.string().trim().min(3).max(300), amountCents: z.number().int().refine((n) => n !== 0, 'Amount cannot be zero.') }).strict();
pipelineRouter.post('/jobs/:id/change-orders', authorize('pipeline:manage'), validate({ params: idParams, body: changeOrderBody }), h(async (req, res) => {
  const b = getValidatedBody<z.infer<typeof changeOrderBody>>(req);
  res.status(201).json({ data: await service.addChangeOrder({ auth: auth(req), id: getValidatedParams<{ id: string }>(req).id, description: b.description, amountCents: b.amountCents, requestId: req.requestId, ip: req.ip }) });
}));

pipelineRouter.post('/backfill', authorize('pipeline:manage'), h(async (req, res) => {
  res.status(200).json({ data: await service.backfillPipeline(requireAuth(req).userId) });
}));
