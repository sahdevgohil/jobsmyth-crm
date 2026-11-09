import type { Request, Response } from 'express';
import type { z } from 'zod';
import { requireAuth } from '../../middleware/authenticate.js';
import {
  getValidatedBody,
  getValidatedParams,
  getValidatedQuery,
} from '../../middleware/validate.js';
import * as appointmentService from './appointment.service.js';
import type {
  appointmentIdParamsSchema,
  appointmentReminderBodySchema,
  cancelAppointmentBodySchema,
  createAppointmentBodySchema,
  listAppointmentsQuerySchema,
  rescheduleAppointmentBodySchema,
  updateAppointmentBodySchema,
} from './appointment.validation.js';

function authCtx(req: Request) {
  const auth = requireAuth(req);
  return { userId: auth.userId, role: auth.role };
}

export async function list(req: Request, res: Response): Promise<void> {
  const query = getValidatedQuery<z.infer<typeof listAppointmentsQuerySchema>>(req);
  const result = await appointmentService.listAppointments({
    auth: authCtx(req),
    page: query.page,
    pageSize: query.pageSize,
    assignedTo: query.assignedTo,
    status: query.status,
    typeKey: query.typeKey,
    from: query.from,
    to: query.to,
    customerId: query.customerId,
    leadId: query.leadId,
    search: query.search,
  });
  res.status(200).json(result);
}

export async function create(req: Request, res: Response): Promise<void> {
  const body = getValidatedBody<z.infer<typeof createAppointmentBodySchema>>(req);
  const data = await appointmentService.createAppointment({
    auth: authCtx(req),
    ...body,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(201).json({ data });
}

export async function get(req: Request, res: Response): Promise<void> {
  const params = getValidatedParams<z.infer<typeof appointmentIdParamsSchema>>(req);
  const data = await appointmentService.getAppointment(params.id, authCtx(req));
  res.status(200).json({ data });
}

export async function update(req: Request, res: Response): Promise<void> {
  const params = getValidatedParams<z.infer<typeof appointmentIdParamsSchema>>(req);
  const body = getValidatedBody<z.infer<typeof updateAppointmentBodySchema>>(req);
  const data = await appointmentService.updateAppointment({
    auth: authCtx(req),
    id: params.id,
    patch: body,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(200).json({ data });
}

export async function cancel(req: Request, res: Response): Promise<void> {
  const params = getValidatedParams<z.infer<typeof appointmentIdParamsSchema>>(req);
  const body = getValidatedBody<z.infer<typeof cancelAppointmentBodySchema>>(req);
  const data = await appointmentService.cancelAppointment({
    auth: authCtx(req),
    id: params.id,
    reason: body.reason,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(200).json({ data });
}

export async function reschedule(req: Request, res: Response): Promise<void> {
  const params = getValidatedParams<z.infer<typeof appointmentIdParamsSchema>>(req);
  const body = getValidatedBody<z.infer<typeof rescheduleAppointmentBodySchema>>(req);
  const data = await appointmentService.rescheduleAppointment({
    auth: authCtx(req),
    id: params.id,
    startAt: body.startAt,
    endAt: body.endAt,
    force: body.force,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(200).json({ data });
}

export async function reminders(req: Request, res: Response): Promise<void> {
  const params = getValidatedParams<z.infer<typeof appointmentIdParamsSchema>>(req);
  const body = getValidatedBody<z.infer<typeof appointmentReminderBodySchema>>(req);
  const data = await appointmentService.setAppointmentReminders({
    auth: authCtx(req),
    id: params.id,
    email: body.email,
    sms: body.sms,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(200).json({ data });
}
