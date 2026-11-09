import mongoose from 'mongoose';
import type { Role } from '../../config/permissions.js';
import { AppError } from '../../utils/errors.js';
import { CustomerModel } from '../customers/customer.model.js';
import { ProjectModel } from '../projects/project.model.js';
import { LookupValueModel } from '../settings/lookup-value.model.js';
import { AfterSalesModel } from './after-sales.model.js';

export type AuthContext = { userId: string; role: Role };

export type AfterSalesDto = {
  id: string;
  projectId: string;
  customerId: string;
  propertyId: string | null;
  completionConfirmedAt: string | null;
  completionConfirmedBy: string | null;
  feedbackRating: number | null;
  feedbackComment: string;
  warrantyLookupKey: string | null;
  warrantyNotes: string;
  followUpDueAt: string | null;
  followUpCompletedAt: string | null;
  serviceHistoryNotes: string;
  customerNotesVisible: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type PortalAfterSalesDto = {
  id: string;
  projectId: string;
  customerId: string;
  propertyId: string | null;
  completionConfirmedAt: string | null;
  feedbackRating: number | null;
  feedbackComment: string;
  warrantyLookupKey: string | null;
  followUpDueAt: string | null;
  followUpCompletedAt: string | null;
  customerNotesVisible: string;
  createdAt: string;
  updatedAt: string;
};

function toDto(doc: {
  _id: mongoose.Types.ObjectId;
  projectId: mongoose.Types.ObjectId;
  customerId: mongoose.Types.ObjectId;
  propertyId?: mongoose.Types.ObjectId | null;
  completionConfirmedAt?: Date | null;
  completionConfirmedBy?: mongoose.Types.ObjectId | null;
  feedbackRating?: number | null;
  feedbackComment?: string | null;
  warrantyLookupKey?: string | null;
  warrantyNotes?: string | null;
  followUpDueAt?: Date | null;
  followUpCompletedAt?: Date | null;
  serviceHistoryNotes?: string | null;
  customerNotesVisible?: string | null;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}): AfterSalesDto {
  return {
    id: doc._id.toString(),
    projectId: doc.projectId.toString(),
    customerId: doc.customerId.toString(),
    propertyId: doc.propertyId ? doc.propertyId.toString() : null,
    completionConfirmedAt: doc.completionConfirmedAt
      ? doc.completionConfirmedAt.toISOString()
      : null,
    completionConfirmedBy: doc.completionConfirmedBy
      ? doc.completionConfirmedBy.toString()
      : null,
    feedbackRating: doc.feedbackRating ?? null,
    feedbackComment: doc.feedbackComment ?? '',
    warrantyLookupKey: doc.warrantyLookupKey ?? null,
    warrantyNotes: doc.warrantyNotes ?? '',
    followUpDueAt: doc.followUpDueAt ? doc.followUpDueAt.toISOString() : null,
    followUpCompletedAt: doc.followUpCompletedAt ? doc.followUpCompletedAt.toISOString() : null,
    serviceHistoryNotes: doc.serviceHistoryNotes ?? '',
    customerNotesVisible: doc.customerNotesVisible ?? '',
    createdBy: doc.createdBy.toString(),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export function toPortalDto(dto: AfterSalesDto): PortalAfterSalesDto {
  return {
    id: dto.id,
    projectId: dto.projectId,
    customerId: dto.customerId,
    propertyId: dto.propertyId,
    completionConfirmedAt: dto.completionConfirmedAt,
    feedbackRating: dto.feedbackRating,
    feedbackComment: dto.feedbackComment,
    warrantyLookupKey: dto.warrantyLookupKey,
    followUpDueAt: dto.followUpDueAt,
    followUpCompletedAt: dto.followUpCompletedAt,
    customerNotesVisible: dto.customerNotesVisible,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  };
}

async function ownedCustomerFilter(auth: AuthContext): Promise<Record<string, unknown>> {
  if (auth.role === 'admin') return {};
  const ids = await CustomerModel.find({ ownerId: auth.userId }).distinct('_id');
  return { customerId: { $in: ids } };
}

async function assertCustomerAccess(customerId: string, auth: AuthContext): Promise<void> {
  if (!mongoose.isValidObjectId(customerId)) {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Customer not found.' });
  }
  const filter: Record<string, unknown> = { _id: customerId };
  if (auth.role !== 'admin') filter.ownerId = auth.userId;
  const row = await CustomerModel.findOne(filter).select({ _id: 1 });
  if (!row) {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Customer not found.' });
  }
}

async function assertWarrantyKey(key: string | null | undefined): Promise<void> {
  if (!key) return;
  const lookup = await LookupValueModel.findOne({
    type: 'warranty_type',
    key,
    isActive: true,
  }).select({ _id: 1 });
  if (!lookup) {
    throw new AppError({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'warrantyLookupKey must match an active warranty_type lookup.',
      details: [{ path: 'warrantyLookupKey', message: 'Unknown warranty type' }],
    });
  }
}

export async function listAfterSales(input: {
  auth: AuthContext;
  customerId?: string;
  projectId?: string;
}): Promise<AfterSalesDto[]> {
  const scope = await ownedCustomerFilter(input.auth);
  const filter: Record<string, unknown> = { ...scope };
  if (input.customerId) {
    await assertCustomerAccess(input.customerId, input.auth);
    filter.customerId = input.customerId;
  }
  if (input.projectId) filter.projectId = input.projectId;
  const rows = await AfterSalesModel.find(filter).sort({ createdAt: -1 }).limit(200);
  return rows.map(toDto);
}

export async function getAfterSales(input: {
  auth: AuthContext;
  id: string;
}): Promise<AfterSalesDto> {
  if (!mongoose.isValidObjectId(input.id)) {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'After-sales record not found.' });
  }
  const scope = await ownedCustomerFilter(input.auth);
  const row = await AfterSalesModel.findOne({ _id: input.id, ...scope });
  if (!row) {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'After-sales record not found.' });
  }
  return toDto(row);
}

export async function createAfterSales(input: {
  auth: AuthContext;
  projectId: string;
  customerId: string;
  propertyId?: string;
  completionConfirmedAt?: string;
  feedbackRating?: number;
  feedbackComment?: string;
  warrantyLookupKey?: string;
  warrantyNotes?: string;
  followUpDueAt?: string;
  followUpCompletedAt?: string;
  serviceHistoryNotes?: string;
  customerNotesVisible?: string;
}): Promise<AfterSalesDto> {
  await assertCustomerAccess(input.customerId, input.auth);
  await assertWarrantyKey(input.warrantyLookupKey);

  if (!mongoose.isValidObjectId(input.projectId)) {
    throw new AppError({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Project not found.',
      details: [{ path: 'projectId', message: 'Project not found' }],
    });
  }
  const project = await ProjectModel.findById(input.projectId);
  if (!project || project.customerId.toString() !== input.customerId) {
    throw new AppError({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Project not found for this customer.',
      details: [{ path: 'projectId', message: 'Project not found for this customer' }],
    });
  }

  const existing = await AfterSalesModel.findOne({ projectId: input.projectId });
  if (existing) {
    throw new AppError({
      status: 409,
      code: 'CONFLICT',
      message: 'After-sales record already exists for this project.',
    });
  }

  const completionConfirmedAt = input.completionConfirmedAt
    ? new Date(input.completionConfirmedAt)
    : null;

  const row = await AfterSalesModel.create({
    projectId: input.projectId,
    customerId: input.customerId,
    propertyId: input.propertyId ?? project.propertyId ?? null,
    completionConfirmedAt,
    completionConfirmedBy: completionConfirmedAt ? input.auth.userId : null,
    feedbackRating: input.feedbackRating ?? null,
    feedbackComment: input.feedbackComment ?? '',
    warrantyLookupKey: input.warrantyLookupKey ?? null,
    warrantyNotes: input.warrantyNotes ?? '',
    followUpDueAt: input.followUpDueAt ? new Date(input.followUpDueAt) : null,
    followUpCompletedAt: input.followUpCompletedAt ? new Date(input.followUpCompletedAt) : null,
    serviceHistoryNotes: input.serviceHistoryNotes ?? '',
    customerNotesVisible: input.customerNotesVisible ?? '',
    createdBy: input.auth.userId,
  });
  return toDto(row);
}

export async function updateAfterSales(input: {
  auth: AuthContext;
  id: string;
  propertyId?: string | null;
  completionConfirmedAt?: string | null;
  feedbackRating?: number | null;
  feedbackComment?: string;
  warrantyLookupKey?: string | null;
  warrantyNotes?: string;
  followUpDueAt?: string | null;
  followUpCompletedAt?: string | null;
  serviceHistoryNotes?: string;
  customerNotesVisible?: string;
}): Promise<AfterSalesDto> {
  if (!mongoose.isValidObjectId(input.id)) {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'After-sales record not found.' });
  }
  const scope = await ownedCustomerFilter(input.auth);
  const row = await AfterSalesModel.findOne({ _id: input.id, ...scope });
  if (!row) {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'After-sales record not found.' });
  }

  if (input.warrantyLookupKey !== undefined) {
    await assertWarrantyKey(input.warrantyLookupKey);
    row.warrantyLookupKey = input.warrantyLookupKey;
  }
  if (input.propertyId !== undefined) {
    row.propertyId = input.propertyId
      ? new mongoose.Types.ObjectId(input.propertyId)
      : null;
  }
  if (input.completionConfirmedAt !== undefined) {
    if (input.completionConfirmedAt === null) {
      row.completionConfirmedAt = null;
      row.completionConfirmedBy = null;
    } else {
      row.completionConfirmedAt = new Date(input.completionConfirmedAt);
      row.completionConfirmedBy = new mongoose.Types.ObjectId(input.auth.userId);
    }
  }
  if (input.feedbackRating !== undefined) row.feedbackRating = input.feedbackRating;
  if (input.feedbackComment !== undefined) row.feedbackComment = input.feedbackComment;
  if (input.warrantyNotes !== undefined) row.warrantyNotes = input.warrantyNotes;
  if (input.followUpDueAt !== undefined) {
    row.followUpDueAt = input.followUpDueAt ? new Date(input.followUpDueAt) : null;
  }
  if (input.followUpCompletedAt !== undefined) {
    row.followUpCompletedAt = input.followUpCompletedAt
      ? new Date(input.followUpCompletedAt)
      : null;
  }
  if (input.serviceHistoryNotes !== undefined) {
    row.serviceHistoryNotes = input.serviceHistoryNotes;
  }
  if (input.customerNotesVisible !== undefined) {
    row.customerNotesVisible = input.customerNotesVisible;
  }

  await row.save();
  return toDto(row);
}
