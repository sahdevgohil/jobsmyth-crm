import { z } from 'zod';
import { paginationQuerySchema } from '../../utils/pagination.js';
import {
  MEASUREMENT_PROVIDERS,
  MEASUREMENT_UNITS,
} from './measurement.model.js';

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const isoDateTimeSchema = z.string().datetime({ offset: true });
const nonNegative = z.number().finite().nonnegative().max(100_000_000);

/**
 * Field set shared by create, import and update.
 * `providerStatus` is deliberately NOT accepted from clients: it is always set by the server and
 * never `connected` (no live provider integration exists).
 */
const measurementFields = {
  customerId: objectIdSchema.optional(),
  inspectionId: objectIdSchema.optional(),
  provider: z.enum(MEASUREMENT_PROVIDERS).optional(),
  measurementDate: isoDateTimeSchema.optional(),
  units: z.enum(MEASUREMENT_UNITS).optional(),
  totalArea: nonNegative.optional(),
  facets: z.number().int().nonnegative().max(100_000).optional(),
  pitch: z.string().trim().max(50).optional(),
  ridge: nonNegative.optional(),
  hip: nonNegative.optional(),
  valley: nonNegative.optional(),
  eave: nonNegative.optional(),
  rake: nonNegative.optional(),
  notes: z.string().max(10_000).optional(),
};

export const listMeasurementsQuerySchema = paginationQuerySchema
  .extend({
    customerId: objectIdSchema.optional(),
    propertyId: objectIdSchema.optional(),
    inspectionId: objectIdSchema.optional(),
    source: z.enum(['manual', 'import', 'external', 'google_solar']).optional(),
  })
  .strict();

export const createMeasurementBodySchema = z
  .object({
    propertyId: objectIdSchema,
    source: z.enum(['manual', 'external']).optional(),
    ...measurementFields,
  })
  .strict();

/** Manual data entry from a file the user read. Not a live provider sync. */
export const importMeasurementBodySchema = z
  .object({
    propertyId: objectIdSchema,
    importedFilename: z.string().trim().min(1).max(255),
    ...measurementFields,
  })
  .strict();

/** Ownership links (customer/property/inspection) are immutable after creation. */
export const updateMeasurementBodySchema = z
  .object({
    ...measurementFields,
    importedFilename: z.string().trim().min(1).max(255).optional(),
  })
  .omit({ customerId: true, inspectionId: true })
  .strict();

export const measurementIdParamsSchema = z.object({ id: z.string().min(1) }).strict();
