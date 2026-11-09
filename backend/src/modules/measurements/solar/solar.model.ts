import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

export const SOLAR_REQUEST_KINDS = ['geocode', 'building_insights', 'data_layers'] as const;
export type SolarRequestKind = (typeof SOLAR_REQUEST_KINDS)[number];

/** One row per outbound Google request. This is the usage ledger and the request history. */
const solarRequestSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    kind: { type: String, enum: SOLAR_REQUEST_KINDS, required: true },
    /** building_insights: requested quality. */
    quality: { type: String },
    latitude: { type: Number },
    longitude: { type: Number },
    status: { type: String, enum: ['ok', 'not_found', 'error'], required: true },
    errorCode: { type: String },
    durationMs: { type: Number },
    propertyId: { type: Schema.Types.ObjectId, ref: 'Property' },
    measurementId: { type: Schema.Types.ObjectId, ref: 'Measurement' },
    /** Calendar month (UTC) used for the monthly counters, e.g. 2026-11. */
    /** Seeded demonstration rows: shown in history, never counted toward limits. */
    isDemo: { type: Boolean, default: false },
    month: { type: String, required: true },
    day: { type: String, required: true },
    requestedAt: { type: Date, default: () => new Date(), required: true },
    /** Provider response kept for a limited time (see rawExpiresAt) so a retry or import fix needs no new paid call. */
    rawResponse: { type: Schema.Types.Mixed },
    rawExpiresAt: { type: Date },
  },
  { timestamps: false },
);
solarRequestSchema.index({ companyId: 1, month: 1, kind: 1 });
solarRequestSchema.index({ companyId: 1, day: 1, kind: 1 });
solarRequestSchema.index({ companyId: 1, requestedAt: -1 });

export type SolarRequestDocument = HydratedDocument<InferSchemaType<typeof solarRequestSchema>>;
export const SolarRequestModel = model('SolarRequest', solarRequestSchema, 'solar_requests');

const kindLimits = { building_insights: { type: Number }, data_layers: { type: Number }, geocode: { type: Number } };

const measurementSettingsSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, unique: true },
    enabled: { type: Boolean, default: true },
    preferredQuality: { type: String, enum: ['HIGH', 'MEDIUM', 'BASE'], default: 'HIGH' },
    allowBaseFallback: { type: Boolean, default: true },
    /** Hard daily stop per request kind. */
    dailyLimit: { type: new Schema(kindLimits, { _id: false }), default: () => ({ building_insights: 200, data_layers: 20, geocode: 300 }) },
    /** Monthly free allowance per kind, as stated in the project brief. Verify against your Google Cloud pricing page. */
    monthlyFree: { type: new Schema(kindLimits, { _id: false }), default: () => ({ building_insights: 10000, data_layers: 1000, geocode: 10000 }) },
    /** Percent of the monthly allowance at which warnings start. */
    warnPercent: { type: Number, default: 80, min: 1, max: 100 },
    /** When the monthly allowance is used up: block (false) or continue and bill (true). */
    allowOverage: { type: Boolean, default: false },
    /** Admin-entered price per 1,000 requests beyond the allowance, in cents. Unset means unknown: no cost is invented. */
    pricePer1000Cents: { type: new Schema({ building_insights: Number, data_layers: Number, geocode: Number }, { _id: false }), default: () => ({}) },
    /** A new Google call is skipped when a measurement for the same property is younger than this. */
    cacheDays: { type: Number, default: 30, min: 0, max: 365 },
    /** Fetch Data Layers (aerial image, elevation, building mask) after each measurement. */
    includeImagery: { type: Boolean, default: true },
    /** How long the derived aerial image is kept. 0 = never store it (reports then say imagery was not retained). */
    imageryRetentionDays: { type: Number, default: 30, min: 0, max: 365 },
    /** Company material packaging rules. Unset = the built-in defaults. */
    materialRules: { type: [Schema.Types.Mixed], default: undefined },
    /** Waste percentages preselected on new measurements and highlighted as "Recommended" in reports. */
    recommendedPitchedWaste: { type: Number, default: 14, min: 0, max: 30 },
    recommendedFlatWaste: { type: Number, default: 15, min: 0, max: 30 },
    rawRetentionDays: { type: Number, default: 30, min: 0, max: 365 },
    lastConnectionTest: { type: new Schema({ at: Date, ok: Boolean, code: String, httpStatus: Number, message: String, fix: String, quality: String, imageryDate: String, segments: Number, keyFingerprint: String }, { _id: false }) },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

export type MeasurementSettingsDocument = HydratedDocument<InferSchemaType<typeof measurementSettingsSchema>>;
export const MeasurementSettingsModel = model('MeasurementSettings', measurementSettingsSchema, 'measurement_settings');

export const MATERIAL_FAMILIES = ['shingle', 'starter', 'ice_water', 'underlayment', 'hip_ridge', 'valley', 'drip_edge', 'flashing', 'accessory'] as const;
export type MaterialFamily = (typeof MATERIAL_FAMILIES)[number];

/**
 * A product the company actually buys. Coverage is whatever the company enters: nothing here is a supplier specification unless
 * `specConfirmed` is set, and reports print unconfirmed coverage as such.
 */
const materialProductSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    family: { type: String, enum: MATERIAL_FAMILIES, required: true },
    brand: { type: String, trim: true, default: '' },
    name: { type: String, trim: true, required: true },
    packageUnit: { type: String, trim: true, required: true },
    /** Area families: square feet one package covers. Linear families: feet per package. Accessories: units per package. */
    coveragePerPackage: { type: Number, required: true, min: 0.0001 },
    /** Accessories only: which entered count to use (pipeBoots, vents, skylights, chimneys). */
    countKey: { type: String, trim: true },
    enabled: { type: Boolean, default: true },
    specConfirmed: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },
    notes: { type: String, default: '' },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true },
);
materialProductSchema.index({ companyId: 1, family: 1, sortOrder: 1 });
export type MaterialProductDocument = HydratedDocument<InferSchemaType<typeof materialProductSchema>>;
export const MaterialProductModel = model('MaterialProduct', materialProductSchema, 'material_products');
