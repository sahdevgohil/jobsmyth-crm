import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

export const FORM_KINDS = ['intake', 'roofing_job', 'inspection', 'other'] as const;
export type FormKind = (typeof FORM_KINDS)[number];

/**
 * Working copy of a form (edited in the builder). Publishing freezes a copy into FormTemplateVersion;
 * submissions always point at a published version, so editing never changes completed forms.
 */
const formTemplateSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    /** Stable machine key, unique per company (e.g. `roofing_inspection`). */
    key: { type: String, required: true, trim: true, lowercase: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    kind: { type: String, enum: FORM_KINDS, required: true },
    /** Service the form applies to (roofing, remodeling, gutters, siding, ...). */
    serviceType: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
    /** Marks templates installed from the platform defaults (still fully editable per company). */
    systemKey: { type: String, default: '' },
    definition: { type: Schema.Types.Mixed, required: true },
    /** Latest published version number; 0 = never published. */
    publishedVersion: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
formTemplateSchema.index({ companyId: 1, key: 1 }, { unique: true });
formTemplateSchema.index({ companyId: 1, kind: 1, isActive: 1 });

const formTemplateVersionSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    templateId: { type: Schema.Types.ObjectId, ref: 'FormTemplate', required: true },
    key: { type: String, required: true },
    version: { type: Number, required: true },
    name: { type: String, required: true },
    kind: { type: String, enum: FORM_KINDS, required: true },
    definition: { type: Schema.Types.Mixed, required: true },
    changeNote: { type: String, default: '' },
    publishedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: 'publishedAt', updatedAt: false } },
);
formTemplateVersionSchema.index({ companyId: 1, templateId: 1, version: 1 }, { unique: true });

const consentEntrySchema = new Schema(
  {
    granted: { type: Boolean, required: true },
    at: { type: Date, required: true },
    source: { type: String, required: true },
    wording: { type: String, required: true },
    wordingVersion: { type: String, required: true },
    recordedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { _id: false },
);

const formSubmissionSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    /** Client-generated UUID: makes offline sync idempotent. */
    clientId: { type: String, required: true },
    templateId: { type: Schema.Types.ObjectId, ref: 'FormTemplate', required: true },
    templateKey: { type: String, required: true },
    /** The published version used when the submission was created. Never changes. */
    templateVersion: { type: Number, required: true },
    kind: { type: String, enum: FORM_KINDS, required: true },
    status: { type: String, enum: ['draft', 'completed'], default: 'draft' },
    answers: { type: Schema.Types.Mixed, default: {} },
    /** Incremented on every accepted change; used for conflict detection. */
    revision: { type: Number, default: 1 },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer' },
    propertyId: { type: Schema.Types.ObjectId, ref: 'Property' },
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead' },
    appointmentId: { type: Schema.Types.ObjectId, ref: 'Appointment' },
    inspectionId: { type: Schema.Types.ObjectId, ref: 'Inspection' },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project' },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User' },
    consent: {
      sms: { type: consentEntrySchema, default: undefined },
      email: { type: consentEntrySchema, default: undefined },
    },
    completedAt: { type: Date },
    completedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    /** Generated PDF report (File id), when one exists. */
    reportFileId: { type: Schema.Types.ObjectId, ref: 'File' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    clientCreatedAt: { type: Date },
  },
  { timestamps: true },
);
formSubmissionSchema.index({ companyId: 1, clientId: 1 }, { unique: true });
formSubmissionSchema.index({ companyId: 1, customerId: 1, createdAt: -1 });
formSubmissionSchema.index({ companyId: 1, inspectionId: 1 });
formSubmissionSchema.index({ companyId: 1, templateKey: 1, status: 1 });

export type FormTemplateDocument = HydratedDocument<InferSchemaType<typeof formTemplateSchema> & { createdAt: Date; updatedAt: Date }>;
export type FormTemplateVersionDocument = HydratedDocument<InferSchemaType<typeof formTemplateVersionSchema> & { publishedAt: Date }>;
export type FormSubmissionDocument = HydratedDocument<InferSchemaType<typeof formSubmissionSchema> & { createdAt: Date; updatedAt: Date }>;

export const FormTemplateModel = model('FormTemplate', formTemplateSchema, 'formTemplates');
export const FormTemplateVersionModel = model('FormTemplateVersion', formTemplateVersionSchema, 'formTemplateVersions');
export const FormSubmissionModel = model('FormSubmission', formSubmissionSchema, 'formSubmissions');
