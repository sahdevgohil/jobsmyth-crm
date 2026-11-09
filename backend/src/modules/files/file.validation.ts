import { z } from 'zod';
import { paginationQuerySchema } from '../../utils/pagination.js';
import { FILE_CATEGORIES, FILE_VISIBILITIES } from './file.model.js';

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

export const listFilesQuerySchema = paginationQuerySchema
  .extend({
    category: z.enum(FILE_CATEGORIES).optional(),
    customerId: objectIdSchema.optional(),
    propertyId: objectIdSchema.optional(),
    inspectionId: objectIdSchema.optional(),
    projectId: objectIdSchema.optional(),
    formSubmissionId: objectIdSchema.optional(),
    formFieldId: z.string().optional(),
    leadId: objectIdSchema.optional(),
    appointmentId: objectIdSchema.optional(),
    visibility: z.enum(FILE_VISIBILITIES).optional(),
    uploadedBy: objectIdSchema.optional(),
  })
  .strict();

export const uploadFileBodySchema = z
  .object({
    filename: z.string().trim().min(1).max(255),
    // Allowlist is enforced in the service so a disallowed type yields 415 (not a generic 400).
    mimeType: z.string().trim().min(1).max(100),
    category: z.enum(FILE_CATEGORIES),
    /** Base64 payload. A `data:<mime>;base64,` prefix is tolerated and stripped. */
    contentBase64: z.string().min(1),
    caption: z.string().trim().max(500).optional(),
    visibility: z.enum(FILE_VISIBILITIES).optional(),
    customerId: objectIdSchema.optional(),
    propertyId: objectIdSchema.optional(),
    inspectionId: objectIdSchema.optional(),
    projectId: objectIdSchema.optional(),
    leadId: objectIdSchema.optional(),
    appointmentId: objectIdSchema.optional(),
    /** Dynamic-form photos: attach to a submission field. `clientId` makes retried offline uploads idempotent. */
    formSubmissionId: objectIdSchema.optional(),
    formFieldId: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/).optional(),
    tag: z.string().trim().max(100).optional(),
    capturedAt: z.string().datetime().optional(),
    gps: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).strict().optional(),
    clientId: z.string().uuid().optional(),
  })
  .strict();

export const fileIdParamsSchema = z.object({ id: z.string().min(1) }).strict();
