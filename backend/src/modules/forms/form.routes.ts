import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireAuth } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { requirePasswordChanged } from '../../middleware/require-password-changed.js';
import { getValidatedBody, getValidatedParams, getValidatedQuery, validate } from '../../middleware/validate.js';
import { FORM_KINDS } from './form.model.js';
import * as service from './form.service.js';
import { generateReport } from './report.service.js';
import { submitIntake } from './intake.service.js';
import { RevisionConflict, type FormCtx } from './form.service.js';

export const formsRouter = Router();
formsRouter.use(authenticate, requirePasswordChanged);

function ctx(req: Request): FormCtx {
  const a = requireAuth(req);
  return { userId: a.userId, companyId: a.companyId, role: a.role, permissions: a.permissions };
}

/** Runs an async handler; a stale-revision conflict is returned with the server copy so the client can review it. */
function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    void fn(req, res).catch((err: unknown) => {
      if (err instanceof RevisionConflict) {
        res.status(409).json({ error: { code: 'REVISION_CONFLICT', message: err.message }, data: { submission: err.server } });
        return;
      }
      next(err);
    });
  };
}

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const idParams = z.object({ id: z.string().min(1) }).strict();
const links = z
  .object({ customerId: objectId, propertyId: objectId, leadId: objectId, appointmentId: objectId, inspectionId: objectId, projectId: objectId })
  .partial()
  .strict();
const answers = z.record(z.string().max(64), z.unknown());

// ------------------------------------------------------------------ templates
const listTemplatesQuery = z
  .object({ kind: z.enum(FORM_KINDS).optional(), active: z.enum(['true', 'false']).optional().transform((v) => (v === undefined ? undefined : v === 'true')) })
  .strict();
formsRouter.get('/templates', authorize('forms:read'), validate({ query: listTemplatesQuery }), handle(async (req, res) => {
  const q = getValidatedQuery<z.infer<typeof listTemplatesQuery>>(req);
  res.status(200).json({ data: await service.listTemplates(ctx(req), q) });
}));

const createTemplateBody = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
    name: z.string().trim().min(1).max(200),
    description: z.string().max(2000).optional(),
    kind: z.enum(FORM_KINDS),
    serviceType: z.string().max(100).optional(),
    definition: z.unknown(),
  })
  .strict();
formsRouter.post('/templates', authorize('forms:manage'), validate({ body: createTemplateBody }), handle(async (req, res) => {
  const b = getValidatedBody<z.infer<typeof createTemplateBody>>(req);
  const data = await service.createTemplate(ctx(req), { ...b, definition: b.definition as never, requestId: req.requestId, ip: req.ip });
  res.status(201).json({ data });
}));

formsRouter.post('/templates/install-defaults', authorize('forms:manage'), handle(async (req, res) => {
  res.status(200).json({ data: await service.installDefaultTemplates(ctx(req)) });
}));

formsRouter.get('/templates/:id', authorize('forms:read'), validate({ params: idParams }), handle(async (req, res) => {
  res.status(200).json({ data: await service.getTemplate(ctx(req), getValidatedParams<{ id: string }>(req).id) });
}));

const updateTemplateBody = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    serviceType: z.string().max(100).optional(),
    isActive: z.boolean().optional(),
    definition: z.unknown().optional(),
  })
  .strict();
formsRouter.patch('/templates/:id', authorize('forms:manage'), validate({ params: idParams, body: updateTemplateBody }), handle(async (req, res) => {
  const b = getValidatedBody<z.infer<typeof updateTemplateBody>>(req);
  const data = await service.updateTemplate(ctx(req), getValidatedParams<{ id: string }>(req).id, { ...b, definition: b.definition as never }, { requestId: req.requestId, ip: req.ip });
  res.status(200).json({ data });
}));

const publishBody = z.object({ changeNote: z.string().max(500).optional() }).strict();
formsRouter.post('/templates/:id/publish', authorize('forms:manage'), validate({ params: idParams, body: publishBody }), handle(async (req, res) => {
  const b = getValidatedBody<z.infer<typeof publishBody>>(req);
  res.status(200).json({ data: await service.publishTemplate(ctx(req), getValidatedParams<{ id: string }>(req).id, b.changeNote, { requestId: req.requestId, ip: req.ip }) });
}));

formsRouter.get('/templates/:id/versions', authorize('forms:read'), validate({ params: idParams }), handle(async (req, res) => {
  res.status(200).json({ data: await service.listVersions(ctx(req), getValidatedParams<{ id: string }>(req).id) });
}));

const versionParams = z.object({ id: z.string().min(1), version: z.coerce.number().int().min(1) }).strict();
formsRouter.get('/templates/:id/versions/:version', authorize('forms:read'), validate({ params: versionParams }), handle(async (req, res) => {
  const p = getValidatedParams<z.infer<typeof versionParams>>(req);
  res.status(200).json({ data: await service.getVersion(ctx(req), p.id, p.version) });
}));

// ------------------------------------------------------------------ submissions
const clientId = z.string().uuid();
const createSubmissionBody = z
  .object({
    clientId,
    templateKey: z.string().min(1).optional(),
    templateId: objectId.optional(),
    templateVersion: z.number().int().min(1).optional(),
    answers: answers.optional(),
    links: links.optional(),
    assignedTo: objectId.optional(),
    clientCreatedAt: z.string().datetime().optional(),
  })
  .strict()
  .refine((b) => b.templateKey || b.templateId, { message: 'templateKey or templateId is required' });
formsRouter.post('/submissions', authorize('forms:submit'), validate({ body: createSubmissionBody }), handle(async (req, res) => {
  const b = getValidatedBody<z.infer<typeof createSubmissionBody>>(req);
  const r = await service.createSubmission(ctx(req), { ...b, requestId: req.requestId, ip: req.ip });
  res.status(r.created ? 201 : 200).json({ data: r.submission, meta: { created: r.created } });
}));

const listSubmissionsQuery = z
  .object({
    customerId: objectId.optional(), propertyId: objectId.optional(), inspectionId: objectId.optional(),
    templateKey: z.string().optional(), status: z.enum(['draft', 'completed']).optional(), kind: z.enum(FORM_KINDS).optional(),
    page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
formsRouter.get('/submissions', authorize('forms:read'), validate({ query: listSubmissionsQuery }), handle(async (req, res) => {
  const q = getValidatedQuery<z.infer<typeof listSubmissionsQuery>>(req);
  const r = await service.listSubmissions(ctx(req), q);
  res.status(200).json({ data: r.data, meta: { page: q.page, pageSize: q.pageSize, total: r.total } });
}));

formsRouter.get('/submissions/:id', authorize('forms:read'), validate({ params: idParams }), handle(async (req, res) => {
  res.status(200).json({ data: await service.getSubmission(ctx(req), getValidatedParams<{ id: string }>(req).id) });
}));

const updateSubmissionBody = z.object({ answers, expectedRevision: z.number().int().min(1).optional(), links: links.optional() }).strict();
formsRouter.patch('/submissions/:id', authorize('forms:submit'), validate({ params: idParams, body: updateSubmissionBody }), handle(async (req, res) => {
  const b = getValidatedBody<z.infer<typeof updateSubmissionBody>>(req);
  const r = await service.updateSubmission(ctx(req), getValidatedParams<{ id: string }>(req).id, { ...b, requestId: req.requestId, ip: req.ip });
  res.status(200).json({ data: r.submission, meta: { changed: r.changed } });
}));

const completeBody = z.object({ expectedRevision: z.number().int().min(1).optional() }).strict();
formsRouter.post('/submissions/:id/complete', authorize('forms:submit'), validate({ params: idParams, body: completeBody }), handle(async (req, res) => {
  const b = getValidatedBody<z.infer<typeof completeBody>>(req);
  res.status(200).json({ data: await service.completeSubmission(ctx(req), getValidatedParams<{ id: string }>(req).id, { ...b, requestId: req.requestId, ip: req.ip }) });
}));

const syncBody = z
  .object({
    clientId,
    templateKey: z.string().min(1),
    templateVersion: z.number().int().min(1).optional(),
    answers,
    baseRevision: z.number().int().min(0).optional(),
    links: links.optional(),
    complete: z.boolean().optional(),
    clientCreatedAt: z.string().datetime().optional(),
  })
  .strict();
/** Offline sync: one idempotent call per submission. Always HTTP 200 with a per-item status. */
formsRouter.post('/sync', authorize('forms:submit'), validate({ body: syncBody }), handle(async (req, res) => {
  const b = getValidatedBody<z.infer<typeof syncBody>>(req);
  const result = await service.syncSubmission(ctx(req), { ...b, requestId: req.requestId, ip: req.ip });
  res.status(200).json({ data: result });
}));

const intakeBody = z
  .object({ clientId, templateVersion: z.number().int().min(1).optional(), answers, force: z.boolean().optional() })
  .strict();
/** Intake: customer + property + lead + consent from one submission. Idempotent on clientId. */
formsRouter.post('/intake', authorize('forms:submit'), authorize('customers:create'), authorize('leads:create'), validate({ body: intakeBody }), handle(async (req, res) => {
  const b = getValidatedBody<z.infer<typeof intakeBody>>(req);
  const r = await submitIntake(ctx(req), { ...b, requestId: req.requestId, ip: req.ip });
  res.status(r.created ? 201 : 200).json({ data: r });
}));

/** Branded PDF of a completed submission. A copy is stored against the customer/property/inspection. */
formsRouter.get('/submissions/:id/report', authorize('forms:read'), validate({ params: idParams }), handle(async (req, res) => {
  const r = await generateReport(ctx(req), getValidatedParams<{ id: string }>(req).id, { requestId: req.requestId, ip: req.ip });
  res.status(200);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${r.filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Report-File-Id', r.fileId);
  res.send(r.buffer);
}));
