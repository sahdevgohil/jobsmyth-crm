import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

export const FILE_CATEGORIES = ['photo', 'document', 'report', 'other'] as const;
export type FileCategory = (typeof FILE_CATEGORIES)[number];

export const FILE_VISIBILITIES = ['internal', 'customer'] as const;
export type FileVisibility = (typeof FILE_VISIBILITIES)[number];

export const ALLOWED_FILE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'text/plain',
] as const;

const fileSchema = new Schema(
  {
    originalFilename: { type: String, required: true, trim: true },
    storageKey: { type: String, required: true },
    mimeType: { type: String, required: true, enum: ALLOWED_FILE_MIME_TYPES },
    sizeBytes: { type: Number, required: true, min: 0 },
    category: { type: String, enum: FILE_CATEGORIES, required: true, default: 'other' },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer' },
    propertyId: { type: Schema.Types.ObjectId, ref: 'Property' },
    inspectionId: { type: Schema.Types.ObjectId, ref: 'Inspection' },
    projectId: { type: Schema.Types.ObjectId },
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead' },
    appointmentId: { type: Schema.Types.ObjectId, ref: 'Appointment' },
    /** Owning company (set for uploads made after multi-company support). */
    companyId: { type: Schema.Types.ObjectId, ref: 'Company' },
    /** Dynamic-form photos: the submission, the field/item they belong to, and capture metadata. */
    formSubmissionId: { type: Schema.Types.ObjectId, ref: 'FormSubmission' },
    formFieldId: { type: String, trim: true },
    tag: { type: String, trim: true, default: '' },
    capturedAt: { type: Date },
    gps: { lat: { type: Number, min: -90, max: 90 }, lng: { type: Number, min: -180, max: 180 } },
    /** Client-generated id so a retried (offline) upload is stored once. */
    clientId: { type: String, trim: true },
    caption: { type: String, trim: true, default: '' },
    /** Roof measurement field photos and aerial derivatives. */
    measurementId: { type: Schema.Types.ObjectId, ref: 'Measurement' },
    photoCategory: { type: String, trim: true },
    relatedItem: { type: String, trim: true },
    photoVerified: { type: Boolean, default: false },
    /** Derived provider imagery is kept only until this date. */
    expiresAt: { type: Date },
    visibility: { type: String, enum: FILE_VISIBILITIES, required: true, default: 'internal' },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

fileSchema.index({ customerId: 1 });
fileSchema.index({ formSubmissionId: 1, formFieldId: 1 });
fileSchema.index({ formSubmissionId: 1, clientId: 1 }, { unique: true, partialFilterExpression: { clientId: { $type: 'string' } } });
fileSchema.index({ propertyId: 1 });
fileSchema.index({ inspectionId: 1, category: 1 });
fileSchema.index({ leadId: 1 });
fileSchema.index({ measurementId: 1, photoCategory: 1 });
fileSchema.index({ appointmentId: 1 });
fileSchema.index({ uploadedBy: 1 });
fileSchema.index({ createdAt: -1 });

export type FileDocument = HydratedDocument<
  InferSchemaType<typeof fileSchema> & { createdAt: Date; updatedAt: Date }
>;

export const FileModel = model('File', fileSchema, 'files');
