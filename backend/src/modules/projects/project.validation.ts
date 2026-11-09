import { z } from 'zod';
import { paginationQuerySchema } from '../../utils/pagination.js';
import {
  PROJECT_PRIORITIES,
  PROJECT_STATUSES,
  TASK_STATUSES,
} from './project.model.js';

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

export const listProjectsQuerySchema = paginationQuerySchema
  .extend({
    status: z.enum(PROJECT_STATUSES).optional(),
    customerId: objectIdSchema.optional(),
    search: z.string().optional(),
  })
  .strict();

export const createProjectBodySchema = z
  .object({
    customerId: objectIdSchema,
    propertyId: objectIdSchema,
    leadId: objectIdSchema.optional(),
    estimateId: objectIdSchema.optional(),
    proposalId: objectIdSchema.optional(),
    projectTypeKey: z.string().optional(),
    projectManagerId: objectIdSchema.optional(),
    assignedEmployeeIds: z.array(objectIdSchema).optional(),
    status: z.enum(PROJECT_STATUSES).optional(),
    priority: z.enum(PROJECT_PRIORITIES).optional(),
    plannedStartAt: z.string().datetime({ offset: true }).optional(),
    plannedEndAt: z.string().datetime({ offset: true }).optional(),
    budgetCents: z.number().int().nonnegative().optional(),
    notes: z.string().optional(),
  })
  .strict();

export const updateProjectBodySchema = z
  .object({
    projectTypeKey: z.string().optional(),
    projectManagerId: objectIdSchema.nullable().optional(),
    assignedEmployeeIds: z.array(objectIdSchema).optional(),
    priority: z.enum(PROJECT_PRIORITIES).optional(),
    plannedStartAt: z.string().datetime({ offset: true }).nullable().optional(),
    plannedEndAt: z.string().datetime({ offset: true }).nullable().optional(),
    actualStartAt: z.string().datetime({ offset: true }).nullable().optional(),
    actualEndAt: z.string().datetime({ offset: true }).nullable().optional(),
    budgetCents: z.number().int().nonnegative().optional(),
    notes: z.string().optional(),
  })
  .strict();

export const changeProjectStatusBodySchema = z
  .object({ status: z.enum(PROJECT_STATUSES) })
  .strict();

export const projectIdParamsSchema = z.object({ id: z.string().min(1) }).strict();

export const createTaskBodySchema = z
  .object({
    title: z.string().trim().min(1),
    assignedTo: objectIdSchema.optional(),
    dueAt: z.string().datetime({ offset: true }).optional(),
    priority: z.enum(PROJECT_PRIORITIES).optional(),
    notes: z.string().optional(),
  })
  .strict();

export const updateTaskBodySchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    assignedTo: objectIdSchema.nullable().optional(),
    dueAt: z.string().datetime({ offset: true }).nullable().optional(),
    priority: z.enum(PROJECT_PRIORITIES).optional(),
    status: z.enum(TASK_STATUSES).optional(),
    notes: z.string().optional(),
  })
  .strict();

export const taskIdParamsSchema = z
  .object({ id: z.string().min(1), taskId: z.string().min(1) })
  .strict();
