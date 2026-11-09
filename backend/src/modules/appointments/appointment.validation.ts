import { z } from 'zod';
import { paginationQuerySchema } from '../../utils/pagination.js';
import { APPOINTMENT_STATUSES } from './appointment.model.js';

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const isoDateTimeSchema = z.string().datetime({ offset: true });

const timeZoneSchema = z.string().min(1).refine(
  (tz) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  },
  { message: 'Invalid time zone' },
);

const forceSchema = z.boolean().optional();

export const listAppointmentsQuerySchema = paginationQuerySchema
  .extend({
    assignedTo: objectIdSchema.optional(),
    status: z.enum(APPOINTMENT_STATUSES).optional(),
    typeKey: z.string().min(1).optional(),
    from: isoDateTimeSchema.optional(),
    to: isoDateTimeSchema.optional(),
    customerId: objectIdSchema.optional(),
    leadId: objectIdSchema.optional(),
    search: z.string().optional(),
  })
  .strict();

export const createAppointmentBodySchema = z
  .object({
    title: z.string().trim().min(1),
    typeKey: z.string().min(1),
    status: z.enum(['scheduled', 'confirmed']).optional(),
    customerId: objectIdSchema.optional(),
    propertyId: objectIdSchema.optional(),
    leadId: objectIdSchema.optional(),
    projectId: objectIdSchema.nullable().optional(),
    assignedTo: objectIdSchema.optional(),
    startAt: isoDateTimeSchema,
    endAt: isoDateTimeSchema,
    timeZone: timeZoneSchema.optional(),
    location: z.string().optional(),
    notes: z.string().optional(),
    force: forceSchema,
  })
  .strict();

export const updateAppointmentBodySchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    typeKey: z.string().min(1).optional(),
    status: z.enum(['scheduled', 'confirmed', 'completed', 'no_show']).optional(),
    customerId: objectIdSchema.nullable().optional(),
    propertyId: objectIdSchema.nullable().optional(),
    leadId: objectIdSchema.nullable().optional(),
    projectId: objectIdSchema.nullable().optional(),
    assignedTo: objectIdSchema.optional(),
    timeZone: timeZoneSchema.optional(),
    location: z.string().optional(),
    notes: z.string().optional(),
    force: forceSchema,
  })
  .strict();

export const appointmentIdParamsSchema = z.object({ id: z.string().min(1) }).strict();

export const cancelAppointmentBodySchema = z
  .object({
    reason: z.string().trim().min(1).optional(),
  })
  .strict();

export const rescheduleAppointmentBodySchema = z
  .object({
    startAt: isoDateTimeSchema,
    endAt: isoDateTimeSchema,
    force: forceSchema,
  })
  .strict();

export const appointmentReminderBodySchema = z
  .object({
    email: z.boolean().optional(),
    sms: z.boolean().optional(),
  })
  .strict();
