import type { Request, Response } from 'express';
import type { z } from 'zod';
import { requireAuth } from '../../middleware/authenticate.js';
import {
  getValidatedBody,
  getValidatedParams,
  getValidatedQuery,
} from '../../middleware/validate.js';
import * as projectService from './project.service.js';
import type {
  changeProjectStatusBodySchema,
  createProjectBodySchema,
  createTaskBodySchema,
  listProjectsQuerySchema,
  projectIdParamsSchema,
  taskIdParamsSchema,
  updateProjectBodySchema,
  updateTaskBodySchema,
} from './project.validation.js';

function authCtx(req: Request) {
  const auth = requireAuth(req);
  return { userId: auth.userId, role: auth.role };
}

export async function list(req: Request, res: Response): Promise<void> {
  const query = getValidatedQuery<z.infer<typeof listProjectsQuerySchema>>(req);
  const result = await projectService.listProjects({
    auth: authCtx(req),
    page: query.page,
    pageSize: query.pageSize,
    status: query.status,
    customerId: query.customerId,
    search: query.search,
  });
  res.status(200).json(result);
}

export async function create(req: Request, res: Response): Promise<void> {
  const body = getValidatedBody<z.infer<typeof createProjectBodySchema>>(req);
  const data = await projectService.createProject({
    auth: authCtx(req),
    ...body,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(201).json({ data });
}

export async function get(req: Request, res: Response): Promise<void> {
  const { id } = getValidatedParams<z.infer<typeof projectIdParamsSchema>>(req);
  const data = await projectService.getProject(id, authCtx(req));
  res.status(200).json({ data });
}

export async function update(req: Request, res: Response): Promise<void> {
  const { id } = getValidatedParams<z.infer<typeof projectIdParamsSchema>>(req);
  const body = getValidatedBody<z.infer<typeof updateProjectBodySchema>>(req);
  const data = await projectService.updateProject({
    auth: authCtx(req),
    id,
    patch: body,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(200).json({ data });
}

export async function changeStatus(req: Request, res: Response): Promise<void> {
  const { id } = getValidatedParams<z.infer<typeof projectIdParamsSchema>>(req);
  const body = getValidatedBody<z.infer<typeof changeProjectStatusBodySchema>>(req);
  const data = await projectService.changeProjectStatus({
    auth: authCtx(req),
    id,
    status: body.status,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(200).json({ data });
}

export async function listTasks(req: Request, res: Response): Promise<void> {
  const { id } = getValidatedParams<z.infer<typeof projectIdParamsSchema>>(req);
  const data = await projectService.listTasks(id, authCtx(req));
  res.status(200).json({ data });
}

export async function createTask(req: Request, res: Response): Promise<void> {
  const { id } = getValidatedParams<z.infer<typeof projectIdParamsSchema>>(req);
  const body = getValidatedBody<z.infer<typeof createTaskBodySchema>>(req);
  const data = await projectService.createTask({
    auth: authCtx(req),
    projectId: id,
    ...body,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(201).json({ data });
}

export async function updateTask(req: Request, res: Response): Promise<void> {
  const { id, taskId } = getValidatedParams<z.infer<typeof taskIdParamsSchema>>(req);
  const body = getValidatedBody<z.infer<typeof updateTaskBodySchema>>(req);
  const data = await projectService.updateTask({
    auth: authCtx(req),
    projectId: id,
    taskId,
    patch: body,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(200).json({ data });
}
