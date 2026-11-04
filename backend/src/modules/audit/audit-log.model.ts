import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { AppError } from '../../utils/errors.js';

const auditLogSchema = new Schema(
  {
    actorType: { type: String, enum: ['user', 'system'], required: true },
    actorId: { type: Schema.Types.ObjectId },
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: String, required: true },
    changes: { type: Schema.Types.Mixed },
    requestId: { type: String },
    ip: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

auditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
auditLogSchema.index({ actorId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });

function rejectMutation(next: (err?: Error) => void): void {
  next(
    new AppError({
      status: 500,
      code: 'AUDIT_IMMUTABLE',
      message: 'Audit log entries cannot be modified or deleted.',
    }),
  );
}

auditLogSchema.pre('updateOne', function (next) {
  rejectMutation(next);
});
auditLogSchema.pre('updateMany', function (next) {
  rejectMutation(next);
});
auditLogSchema.pre('deleteOne', function (next) {
  rejectMutation(next);
});
auditLogSchema.pre('deleteMany', function (next) {
  rejectMutation(next);
});
auditLogSchema.pre('findOneAndUpdate', function (next) {
  rejectMutation(next);
});
auditLogSchema.pre('findOneAndDelete', function (next) {
  rejectMutation(next);
});
auditLogSchema.pre('findOneAndReplace', function (next) {
  rejectMutation(next);
});
auditLogSchema.pre('replaceOne', function (next) {
  rejectMutation(next);
});

export type AuditLogDocument = InferSchemaType<typeof auditLogSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
};

export const AuditLogModel = model('AuditLog', auditLogSchema, 'auditLogs');
