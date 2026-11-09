import { z } from 'zod';
import { paginationQuerySchema } from '../../utils/pagination.js';

const addressSchema = z
  .object({
    line1: z.string().optional(),
    line2: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zip: z.string().optional(),
  })
  .strict();

const contactSchema = z
  .object({
    name: z.string().trim().min(1),
    role: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
  })
  .strict();

export const listPropertiesQuerySchema = paginationQuerySchema
  .extend({ search: z.string().optional(), customerId: z.string().optional() })
  .strict();

export const listCustomersQuerySchema = paginationQuerySchema
  .extend({
    search: z.string().optional(),
    /** Comma-separated customer ids (max 100) for resolving names in list views. */
    ids: z
      .string()
      .regex(/^[a-f\d]{24}(,[a-f\d]{24}){0,99}$/i)
      .optional(),
    includeArchived: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => v === 'true'),
  })
  .strict();

const optionalEmailSchema = z
  .string()
  .optional()
  .refine((v) => v === undefined || v.trim() === '' || z.string().email().safeParse(v).success, {
    message: 'Invalid email address',
  });

export const createCustomerBodySchema = z
  .object({
    type: z.enum(['individual', 'business']),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    companyName: z.string().optional(),
    email: optionalEmailSchema,
    phone: z.string().optional(),
    contacts: z.array(contactSchema).optional(),
    mailingAddress: addressSchema.optional(),
    notes: z.string().optional(),
    ownerId: z.string().optional(),
  })
  .strict();

export const updateCustomerBodySchema = createCustomerBodySchema.partial().strict();

export const customerIdParamsSchema = z.object({ id: z.string().min(1) }).strict();

export const duplicateCheckBodySchema = z
  .object({
    phone: z.string().optional(),
    email: z.string().optional(),
    address: addressSchema.optional(),
  })
  .strict();

export const createPropertyBodySchema = z
  .object({
    address: z
      .object({
        line1: z.string().trim().min(1),
        line2: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        zip: z.string().trim().min(1),
      })
      .strict(),
    propertyTypeKey: z.string().optional(),
    details: z
      .object({
        stories: z.number().int().positive().optional(),
        roofAgeYears: z.number().int().min(0).optional(),
        notes: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const updatePropertyBodySchema = z
  .object({
    address: addressSchema.optional(),
    propertyTypeKey: z.string().optional(),
    details: z
      .object({
        stories: z.number().int().positive().optional(),
        roofAgeYears: z.number().int().min(0).optional(),
        notes: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const propertyIdParamsSchema = z.object({ id: z.string().min(1) }).strict();
