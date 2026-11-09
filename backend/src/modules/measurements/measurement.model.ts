import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

export const MEASUREMENT_SOURCES = ['manual', 'import', 'external', 'google_solar'] as const;
export type MeasurementSource = (typeof MEASUREMENT_SOURCES)[number];

export const MEASUREMENT_PROVIDERS = ['none', 'roofr', 'eagleview', 'hover', 'google_solar'] as const;
export type MeasurementProvider = (typeof MEASUREMENT_PROVIDERS)[number];

/** `connected` is reserved for a validated live integration; no code path sets it today. */
export const MEASUREMENT_PROVIDER_STATUSES = ['not_configured', 'manual_only', 'connected'] as const;
export type MeasurementProviderStatus = (typeof MEASUREMENT_PROVIDER_STATUSES)[number];

export const MEASUREMENT_UNITS = ['sq_ft', 'squares', 'sq_m'] as const;
export type MeasurementUnits = (typeof MEASUREMENT_UNITS)[number];

const measurementSchema = new Schema(
  {
    propertyId: { type: Schema.Types.ObjectId, ref: 'Property', required: true },
    inspectionId: { type: Schema.Types.ObjectId, ref: 'Inspection' },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    source: { type: String, enum: MEASUREMENT_SOURCES, required: true, default: 'manual' },
    provider: { type: String, enum: MEASUREMENT_PROVIDERS, required: true, default: 'none' },
    providerStatus: {
      type: String,
      enum: MEASUREMENT_PROVIDER_STATUSES,
      required: true,
      default: 'manual_only',
    },
    measurementDate: { type: Date, required: true },
    units: { type: String, enum: MEASUREMENT_UNITS, required: true, default: 'sq_ft' },
    totalArea: { type: Number, min: 0 },
    facets: { type: Number, min: 0 },
    pitch: { type: String, trim: true, default: '' },
    ridge: { type: Number, min: 0 },
    hip: { type: Number, min: 0 },
    valley: { type: Number, min: 0 },
    eave: { type: Number, min: 0 },
    rake: { type: Number, min: 0 },
    notes: { type: String, default: '' },
    importedFilename: { type: String, trim: true },
    // --- automated (Google Solar) measurements. All optional: manual records leave these unset. ---
    companyId: { type: Schema.Types.ObjectId, ref: 'Company' },
    /** True only for seeded demonstration records. They are never Google results. */
    isDemo: { type: Boolean, default: false },
    revision: { type: Number, default: 1 },
    supersedesId: { type: Schema.Types.ObjectId, ref: 'Measurement' },
    supersededById: { type: Schema.Types.ObjectId, ref: 'Measurement' },
    /** Normalised provider output, kept exactly as imported. Manual changes never touch this. */
    automated: { type: Schema.Types.Mixed },
    /** Per-field origin: google | calculated | manual. */
    fieldSources: { type: Schema.Types.Mixed },
    /** Per-field human verification flag. */
    verified: { type: Schema.Types.Mixed },
    edges: { type: Schema.Types.Mixed },
    counts: { type: Schema.Types.Mixed },
    corrections: { type: [Schema.Types.Mixed], default: [] },
    reportFileId: { type: Schema.Types.ObjectId, ref: 'File' },
    /** Derived roof geometry (outline, facets, edges, aerial reference). Separate from `automated`, which keeps the provider data as received. */
    geometry: { type: Schema.Types.Mixed },
    /** Waste percentage selected for material calculations and reports. */
    wastePercent: { type: Number, default: 14 },
    /** Waste percentage for flat-roof areas. */
    flatWastePercent: { type: Number, default: 15 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

measurementSchema.index({ propertyId: 1, measurementDate: -1 });
measurementSchema.index({ customerId: 1 });
measurementSchema.index({ inspectionId: 1 });
measurementSchema.index({ companyId: 1, propertyId: 1, provider: 1, createdAt: -1 });

export type MeasurementDocument = HydratedDocument<
  InferSchemaType<typeof measurementSchema> & { createdAt: Date; updatedAt: Date }
>;

export const MeasurementModel = model('Measurement', measurementSchema, 'measurements');
