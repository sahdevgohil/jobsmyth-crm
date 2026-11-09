import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { requirePasswordChanged } from '../../middleware/require-password-changed.js';
import { z } from 'zod';
import { requireAuth } from '../../middleware/authenticate.js';
import { getValidatedQuery, validate } from '../../middleware/validate.js';
import { paginationQuerySchema } from '../../utils/pagination.js';
import { TASK_STATUSES } from './project.model.js';
import { getProjectTimeline, listAllTasks } from './project.service.js';
import * as controller from './project.controller.js';
import {
  changeProjectStatusBodySchema,
  createProjectBodySchema,
  createTaskBodySchema,
  listProjectsQuerySchema,
  projectIdParamsSchema,
  taskIdParamsSchema,
  updateProjectBodySchema,
  updateTaskBodySchema,
} from './project.validation.js';

export const projectsRouter = Router();

projectsRouter.use(authenticate, requirePasswordChanged);

projectsRouter.get(
  '/',
  authorize('projects:read'),
  validate({ query: listProjectsQuerySchema }),
  (req, res, next) => {
    void controller.list(req, res).catch(next);
  },
);

projectsRouter.post(
  '/',
  authorize('projects:create'),
  validate({ body: createProjectBodySchema }),
  (req, res, next) => {
    void controller.create(req, res).catch(next);
  },
);

projectsRouter.get(
  '/:id',
  authorize('projects:read'),
  validate({ params: projectIdParamsSchema }),
  (req, res, next) => {
    void controller.get(req, res).catch(next);
  },
);

projectsRouter.patch(
  '/:id',
  authorize('projects:update'),
  validate({ params: projectIdParamsSchema, body: updateProjectBodySchema }),
  (req, res, next) => {
    void controller.update(req, res).catch(next);
  },
);

projectsRouter.post(
  '/:id/status',
  authorize('projects:update'),
  validate({ params: projectIdParamsSchema, body: changeProjectStatusBodySchema }),
  (req, res, next) => {
    void controller.changeStatus(req, res).catch(next);
  },
);

projectsRouter.get(
  '/:id/tasks',
  authorize('projects:read'),
  validate({ params: projectIdParamsSchema }),
  (req, res, next) => {
    void controller.listTasks(req, res).catch(next);
  },
);

projectsRouter.post(
  '/:id/tasks',
  authorize('projects:update'),
  validate({ params: projectIdParamsSchema, body: createTaskBodySchema }),
  (req, res, next) => {
    void controller.createTask(req, res).catch(next);
  },
);

projectsRouter.patch(
  '/:id/tasks/:taskId',
  authorize('projects:update'),
  validate({ params: taskIdParamsSchema, body: updateTaskBodySchema }),
  (req, res, next) => {
    void controller.updateTask(req, res).catch(next);
  },
);

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const listTasksQuery = paginationQuerySchema
  .extend({
    status: z.enum(TASK_STATUSES).optional(),
    assignedTo: objectId.optional(),
    projectId: objectId.optional(),
  })
  .strict();

projectsRouter.get('/:id/timeline', authorize('projects:read'), (req, res, next) => {
  void (async () => {
    const auth = requireAuth(req);
    const id = String(req.params.id);
    res.status(200).json({ data: await getProjectTimeline(id, { userId: auth.userId, role: auth.role }) });
  })().catch(next);
});

/** Cross-project task list (GET /api/v1/tasks). Updates go through /projects/:id/tasks/:taskId. */
export const tasksRouter = Router();
tasksRouter.use(authenticate, requirePasswordChanged);
tasksRouter.get('/', authorize('projects:read'), validate({ query: listTasksQuery }), (req, res, next) => {
  void (async () => {
    const auth = requireAuth(req);
    const q = getValidatedQuery<z.infer<typeof listTasksQuery>>(req);
    res.status(200).json(await listAllTasks({ auth: { userId: auth.userId, role: auth.role }, ...q }));
  })().catch(next);
});
