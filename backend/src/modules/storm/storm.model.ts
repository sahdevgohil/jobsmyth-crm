import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { EVENT_TYPES, PRECISIONS, QUALITY, SOURCES } from './storm.types.js';

// ------------------------------------------------------------------ events

const stormEventSchema = new Schema(
  {
    eventType: { type: String, enum: EVENT_TYPES, required: true },
    source: { type: String, enum: SOURCES, required: true },
    /** Identity of the report inside its source (NCEI EVENT_ID, or a derived hash for SPC which publishes no id). */
    sourceRecordId: { type: String, required: true },
    eventDate: { type: Date, required: true }, // start of the event, UTC instant
    eventEndDate: { type: Date },
    hailSizeInches: { type: Number },
    windSpeedMph: { type: Number },
    /** The value exactly as the source published it, and its unit, next to the normalized value above. */
    sourceMagnitude: { type: Number },
    sourceMagnitudeUnit: { type: String, enum: ['hundredths_inch', 'inch', 'mph', 'knot'] },
    latitude: { type: Number },
    longitude: { type: Number },
    /** GeoJSON point, present only when the source gave usable coordinates. County-only reports never get an invented point. */
    location: { type: { type: String, enum: ['Point'] }, coordinates: { type: [Number] } },
    coordinatePrecision: { type: String, enum: PRECISIONS, required: true },
    locationDescription: { type: String, default: '' },
    county: { type: String, default: '' },
    state: { type: String, default: '' },
    qualityStatus: { type: String, enum: QUALITY, required: true, default: 'ok' },
    /** hail >= 1.00 in or wind > 50 mph. Wind reports with an unknown speed are stored but never qualify. */
    qualifies: { type: Boolean, required: true, default: false },
    sourceRef: { type: String, default: '' },
    importedAt: { type: Date, required: true },
    updatedAtSource: { type: Date },
    /** Small subset of source fields kept for audit (reporter, narrative excerpt, episode id). Not exposed in lists. */
    rawSourceMetadata: { type: Schema.Types.Mixed },
  },
  { timestamps: false },
);
stormEventSchema.index({ source: 1, sourceRecordId: 1 }, { unique: true });
stormEventSchema.index({ location: '2dsphere' }, { sparse: true });
stormEventSchema.index({ qualifies: 1, eventDate: -1 });
stormEventSchema.index({ eventType: 1, eventDate: -1 });
stormEventSchema.index({ state: 1, county: 1, eventDate: -1 });
stormEventSchema.index({ importedAt: -1 });
export type StormEventDocument = HydratedDocument<InferSchemaType<typeof stormEventSchema>>;
export const StormEventModel = model('StormEvent', stormEventSchema, 'stormEvents');

// ------------------------------------------------------------------ ingestion bookkeeping

/** One unit of source data: an NCEI data year or an SPC report day. Backfills skip units that are already done. */
const unitSchema = new Schema(
  {
    source: { type: String, enum: SOURCES, required: true },
    unitKey: { type: String, required: true }, // ncei:2012  or  spc:2024-05-20
    status: { type: String, enum: ['pending', 'done', 'failed', 'unavailable'], required: true, default: 'pending' },
    /** NCEI creation date of the file that was imported; a newer one makes the unit stale. */
    sourceVersion: { type: String, default: '' },
    counts: { type: new Schema({ rows: Number, inserted: Number, updated: Number, skipped: Number, belowThreshold: Number, invalid: Number }, { _id: false }), default: () => ({}) },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: '' },
    completedAt: { type: Date },
    lastRunId: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);
unitSchema.index({ source: 1, unitKey: 1 }, { unique: true });
export const StormImportUnitModel = model('StormImportUnit', unitSchema, 'stormImportUnits');

const runSchema = new Schema(
  {
    source: { type: String, enum: [...SOURCES, 'all'], required: true },
    kind: { type: String, enum: ['backfill', 'daily', 'range'], required: true },
    rangeFrom: { type: String }, // YYYY-MM-DD or YYYY
    rangeTo: { type: String },
    status: { type: String, enum: ['running', 'completed', 'completed_with_errors', 'failed'], required: true, default: 'running' },
    unitsTotal: { type: Number, default: 0 },
    unitsDone: { type: Number, default: 0 },
    unitsFailed: { type: Number, default: 0 },
    unitsUnavailable: { type: Number, default: 0 },
    unitsSkipped: { type: Number, default: 0 },
    current: { type: String, default: '' },
    counts: { type: new Schema({ rows: Number, inserted: Number, updated: Number, skipped: Number, belowThreshold: Number, invalid: Number }, { _id: false }), default: () => ({ rows: 0, inserted: 0, updated: 0, skipped: 0, belowThreshold: 0, invalid: 0 }) },
    issues: { type: [new Schema({ unit: String, message: String, at: Date }, { _id: false })], default: [] },
    newQualifyingEventIds: { type: [Schema.Types.ObjectId], default: [] },
    startedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    startedAt: { type: Date, required: true },
    heartbeatAt: { type: Date },
    finishedAt: { type: Date },
  },
  { timestamps: false },
);
runSchema.index({ startedAt: -1 });
export type StormImportRunDocument = HydratedDocument<InferSchemaType<typeof runSchema>>;
export const StormImportRunModel = model('StormImportRun', runSchema, 'stormImportRuns');

/** Single-holder lock with an expiry, so two server instances never run the same import. */
const lockSchema = new Schema({ _id: { type: String, required: true }, holder: String, expiresAt: { type: Date, required: true } }, { versionKey: false });
export const StormLockModel = model('StormLock', lockSchema, 'stormLocks');

// ------------------------------------------------------------------ geocoding cache

const geocodeCacheSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    provider: { type: String, required: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    formattedAddress: { type: String, default: '' },
    accuracy: { type: String, required: true },
    precise: { type: Boolean, default: false },
    createdAt: { type: Date, required: true, default: Date.now, expires: 60 * 60 * 24 * 30 }, // Google's terms limit how long coordinates may be cached
  },
  { versionKey: false },
);
export const StormGeocodeCacheModel = model('StormGeocodeCache', geocodeCacheSchema, 'stormGeocodeCache');

// ------------------------------------------------------------------ zones and assignments

const assignmentSchema = new Schema(
  { userId: { type: Schema.Types.ObjectId, ref: 'User' }, at: { type: Date, required: true }, by: { type: Schema.Types.ObjectId, ref: 'User', required: true }, note: { type: String, default: '' } },
  { _id: false },
);
const zoneSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    name: { type: String, required: true, trim: true },
    kind: { type: String, enum: ['radius', 'polygon', 'county'], required: true },
    center: { type: new Schema({ lat: Number, lng: Number }, { _id: false }) },
    radiusMiles: { type: Number },
    /** Outer ring as [lng, lat] pairs. */
    polygon: { type: [[Number]] },
    counties: { type: [new Schema({ state: String, county: String }, { _id: false })], default: [] },
    dateFrom: { type: Date },
    dateTo: { type: Date },
    minHailInches: { type: Number, default: 1 },
    minWindMph: { type: Number, default: 50 },
    notes: { type: String, default: '' },
    assignedUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    assignmentHistory: { type: [assignmentSchema], default: [] },
    archivedAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);
zoneSchema.index({ companyId: 1, archivedAt: 1 });
zoneSchema.index({ assignedUserId: 1 });
export type StormZoneDocument = HydratedDocument<InferSchemaType<typeof zoneSchema> & { createdAt: Date; updatedAt: Date }>;
export const StormZoneModel = model('StormZone', zoneSchema, 'stormZones');

// ------------------------------------------------------------------ alerts

const alertRuleSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    name: { type: String, required: true, trim: true },
    enabled: { type: Boolean, default: true },
    zoneId: { type: Schema.Types.ObjectId, ref: 'StormZone', required: true },
    /** An event counts if it is inside the zone or within this many miles of its boundary/center. */
    radiusMiles: { type: Number, default: 0, min: 0, max: 50 },
    hailMinInches: { type: Number, default: 1 },
    windMinMph: { type: Number, default: 50 },
    notifyAssignee: { type: Boolean, default: true },
    notifyAdmins: { type: Boolean, default: false },
    recipientUserIds: { type: [Schema.Types.ObjectId], default: [] },
    channels: { type: new Schema({ inApp: { type: Boolean, default: true }, email: { type: Boolean, default: false }, sms: { type: Boolean, default: false } }, { _id: false }), default: () => ({ inApp: true, email: false, sms: false }) },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);
alertRuleSchema.index({ companyId: 1, enabled: 1 });
export type StormAlertRuleDocument = HydratedDocument<InferSchemaType<typeof alertRuleSchema> & { createdAt: Date; updatedAt: Date }>;
export const StormAlertRuleModel = model('StormAlertRule', alertRuleSchema, 'stormAlertRules');

const alertSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    ruleId: { type: Schema.Types.ObjectId, ref: 'StormAlertRule', required: true },
    zoneId: { type: Schema.Types.ObjectId, ref: 'StormZone', required: true },
    eventId: { type: Schema.Types.ObjectId, ref: 'StormEvent', required: true },
    eventType: { type: String, enum: EVENT_TYPES, required: true },
    magnitude: { type: Number },
    distanceMiles: { type: Number },
    recipients: { type: [Schema.Types.ObjectId], default: [] },
    /** What really happened per channel: sent, not_configured, skipped, failed. Never claims delivery that did not occur. */
    channelResults: { type: Schema.Types.Mixed },
    message: { type: String, default: '' },
  },
  { timestamps: true },
);
alertSchema.index({ ruleId: 1, eventId: 1 }, { unique: true }); // an event alerts a rule once
alertSchema.index({ companyId: 1, createdAt: -1 });
export const StormAlertModel = model('StormAlert', alertSchema, 'stormAlerts');

// ------------------------------------------------------------------ past-customer follow-up flags

const flagSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    propertyId: { type: Schema.Types.ObjectId, ref: 'Property', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    eventId: { type: Schema.Types.ObjectId, ref: 'StormEvent', required: true },
    completedAt: { type: Date, required: true },
    eventDate: { type: Date, required: true },
    eventType: { type: String, enum: EVENT_TYPES, required: true },
    magnitude: { type: Number },
    distanceMiles: { type: Number, required: true },
    radiusMiles: { type: Number, required: true },
    status: { type: String, enum: ['new', 'reviewed', 'dismissed'], required: true, default: 'new' },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    note: { type: String, default: '' },
    activityIds: { type: [Schema.Types.ObjectId], default: [] },
  },
  { timestamps: true },
);
flagSchema.index({ projectId: 1, eventId: 1 }, { unique: true }); // one flag per completed job and event
flagSchema.index({ companyId: 1, status: 1, eventDate: -1 });
flagSchema.index({ customerId: 1 });
export const StormFollowUpFlagModel = model('StormFollowUpFlag', flagSchema, 'stormFollowUpFlags');
