import { z } from 'zod';
import { LOOKUP_TYPES } from './lookup-value.model.js';

export const patchCompanyBodySchema = z
  .object({
    legalName: z.string().trim().min(1).max(200).optional(),
    displayName: z.string().trim().min(1).max(200).optional(),
    address: z
      .object({
        line1: z.string().optional(),
        line2: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        zip: z.string().optional(),
      })
      .optional(),
    phone: z.string().optional(),
    email: z.string().email().or(z.literal('')).optional(),
    website: z.string().optional(),
    licenseText: z.string().optional(),
    timezone: z.string().min(1).optional(),
    defaultWasteBp: z.number().int().min(0).max(10000).optional(),
    defaultMarginBp: z.number().int().min(0).max(9999).optional(),
    estimateExpiryDays: z.number().int().min(1).max(365).optional(),
    invoiceTermsText: z.string().optional(),
    proposalTermsText: z.string().optional(),
  })
  .strict();

export const lookupTypeParamsSchema = z
  .object({
    type: z.enum(LOOKUP_TYPES),
  })
  .strict();

export const createLookupBodySchema = z
  .object({
    key: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9_]+$/, 'key must be lowercase alphanumeric with underscores'),
    label: z.string().trim().min(1).max(120),
    order: z.number().int().optional(),
  })
  .strict();

export const updateLookupBodySchema = z
  .object({
    label: z.string().trim().min(1).max(120).optional(),
    order: z.number().int().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const lookupIdParamsSchema = z
  .object({
    type: z.enum(LOOKUP_TYPES),
    id: z.string().min(1),
  })
  .strict();
