import mongoose from 'mongoose';
import type { Role } from '../../config/permissions.js';
import { sendEmail } from '../../services/email/email.adapter.js';
import { assertLeadLink } from '../../services/entity-links.js';
import { sendSms } from '../../services/sms/sms.adapter.js';
import { AppError } from '../../utils/errors.js';
import { CustomerModel } from '../customers/customer.model.js';
import { ProjectModel } from '../projects/project.model.js';
import {
  CommunicationModel,
  type CommunicationChannel,
  type CommunicationDirection,
  type CommunicationProvider,
  type DeliveryStatus,
} from './communication.model.js';

export type AuthContext = { userId: string; role: Role };

export type CommunicationDto = {
  id: string;
  customerId: string;
  leadId: string | null;
  projectId: string | null;
  channel: CommunicationChannel;
  direction: CommunicationDirection;
  subject: string;
  body: string;
  deliveryStatus: DeliveryStatus;
  provider: CommunicationProvider;
  providerMessageId: string | null;
  sender: string;
  recipient: string;
  customerVisible: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

function toDto(doc: {
  _id: mongoose.Types.ObjectId;
  customerId: mongoose.Types.ObjectId;
  leadId?: mongoose.Types.ObjectId | null;
  projectId?: mongoose.Types.ObjectId | null;
  channel: string;
  direction: string;
  subject?: string | null;
  body: string;
  deliveryStatus: string;
  provider: string;
  providerMessageId?: string | null;
  sender?: string | null;
  recipient?: string | null;
  customerVisible: boolean;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}): CommunicationDto {
  return {
    id: doc._id.toString(),
    customerId: doc.customerId.toString(),
    leadId: doc.leadId ? doc.leadId.toString() : null,
    projectId: doc.projectId ? doc.projectId.toString() : null,
    channel: doc.channel as CommunicationChannel,
    direction: doc.direction as CommunicationDirection,
    subject: doc.subject ?? '',
    body: doc.body,
    deliveryStatus: doc.deliveryStatus as DeliveryStatus,
    provider: doc.provider as CommunicationProvider,
    providerMessageId: doc.providerMessageId ?? null,
    sender: doc.sender ?? '',
    recipient: doc.recipient ?? '',
    customerVisible: doc.customerVisible,
    createdBy: doc.createdBy.toString(),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

async function assertCustomerAccess(customerId: string, auth: AuthContext): Promise<void> {
  if (!mongoose.isValidObjectId(customerId)) {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Customer not found.' });
  }
  const filter: Record<string, unknown> = { _id: customerId };
  if (auth.role !== 'admin') filter.ownerId = auth.userId;
  const customer = await CustomerModel.findOne(filter).select({ _id: 1 });
  if (!customer) {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Customer not found.' });
  }
}

async function assertProjectAccess(
  projectId: string,
  customerId: string,
  auth: AuthContext,
): Promise<void> {
  if (!mongoose.isValidObjectId(projectId)) {
    throw new AppError({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Project not found.',
      details: [{ path: 'projectId', message: 'Project not found' }],
    });
  }
  const project = await ProjectModel.findById(projectId).select({ _id: 1, customerId: 1 });
  if (!project || project.customerId.toString() !== customerId) {
    throw new AppError({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Project not found.',
      details: [{ path: 'projectId', message: 'Project not found' }],
    });
  }
  if (auth.role !== 'admin') {
    await assertCustomerAccess(customerId, auth);
  }
}

async function resolveListCustomerIds(input: {
  auth: AuthContext;
  customerId?: string;
  leadId?: string;
  projectId?: string;
}): Promise<{ filter: Record<string, unknown> }> {
  const filter: Record<string, unknown> = {};

  if (input.customerId) {
    await assertCustomerAccess(input.customerId, input.auth);
    filter.customerId = input.customerId;
  }
  if (input.leadId) {
    await assertLeadLink(input.auth, input.leadId);
    filter.leadId = input.leadId;
  }
  if (input.projectId) {
    if (!mongoose.isValidObjectId(input.projectId)) {
      throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Project not found.' });
    }
    const ownedCustomerIds =
      input.auth.role === 'admin'
        ? null
        : await CustomerModel.find({ ownerId: input.auth.userId }).distinct('_id');
    const project = await ProjectModel.findOne({
      _id: input.projectId,
      ...(ownedCustomerIds ? { customerId: { $in: ownedCustomerIds } } : {}),
    }).select({ _id: 1, customerId: 1 });
    if (!project) {
      throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Project not found.' });
    }
    filter.projectId = input.projectId;
    if (!input.customerId) filter.customerId = project.customerId;
  }

  if (!input.customerId && !input.leadId && !input.projectId) {
    throw new AppError({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'At least one of customerId, leadId, or projectId is required.',
    });
  }

  if (input.auth.role !== 'admin' && !filter.customerId && !filter.leadId && !filter.projectId) {
    const owned = await CustomerModel.find({ ownerId: input.auth.userId }).distinct('_id');
    filter.customerId = { $in: owned };
  }

  return { filter };
}

export async function listCommunications(input: {
  auth: AuthContext;
  customerId?: string;
  leadId?: string;
  projectId?: string;
  channel?: CommunicationChannel;
}): Promise<CommunicationDto[]> {
  const { filter } = await resolveListCustomerIds(input);
  if (input.channel) filter.channel = input.channel;
  const rows = await CommunicationModel.find(filter).sort({ createdAt: -1 }).limit(500);
  return rows.map(toDto);
}

async function assertLinks(input: {
  auth: AuthContext;
  customerId: string;
  leadId?: string;
  projectId?: string;
}): Promise<void> {
  await assertCustomerAccess(input.customerId, input.auth);
  if (input.leadId) await assertLeadLink(input.auth, input.leadId);
  if (input.projectId) await assertProjectAccess(input.projectId, input.customerId, input.auth);
}

export async function createInternalNote(input: {
  auth: AuthContext;
  customerId: string;
  leadId?: string;
  projectId?: string;
  subject?: string;
  body: string;
}): Promise<CommunicationDto> {
  await assertLinks(input);
  const row = await CommunicationModel.create({
    customerId: input.customerId,
    leadId: input.leadId ?? null,
    projectId: input.projectId ?? null,
    channel: 'internal_note',
    direction: 'internal',
    subject: input.subject ?? '',
    body: input.body,
    deliveryStatus: 'received',
    provider: 'none',
    customerVisible: false,
    createdBy: input.auth.userId,
  });
  return toDto(row);
}

export async function createEmailAttempt(input: {
  auth: AuthContext;
  customerId: string;
  leadId?: string;
  projectId?: string;
  recipient: string;
  subject: string;
  body: string;
}): Promise<CommunicationDto> {
  await assertLinks(input);
  const delivery = await sendEmail({
    to: input.recipient,
    subject: input.subject,
    text: input.body,
  });
  const row = await CommunicationModel.create({
    customerId: input.customerId,
    leadId: input.leadId ?? null,
    projectId: input.projectId ?? null,
    channel: 'email',
    direction: 'outbound',
    subject: input.subject,
    body: input.body,
    deliveryStatus: delivery.status,
    provider: delivery.provider,
    recipient: input.recipient,
    customerVisible: true,
    createdBy: input.auth.userId,
  });
  return toDto(row);
}

export async function createSmsAttempt(input: {
  auth: AuthContext;
  customerId: string;
  leadId?: string;
  projectId?: string;
  recipient: string;
  body: string;
}): Promise<CommunicationDto> {
  await assertLinks(input);
  const delivery = await sendSms({ to: input.recipient, body: input.body });
  const row = await CommunicationModel.create({
    customerId: input.customerId,
    leadId: input.leadId ?? null,
    projectId: input.projectId ?? null,
    channel: 'sms',
    direction: 'outbound',
    subject: '',
    body: input.body,
    deliveryStatus: delivery.status,
    provider: delivery.provider,
    recipient: input.recipient,
    customerVisible: true,
    createdBy: input.auth.userId,
  });
  return toDto(row);
}

/** Portal-safe DTO (customer-visible rows only). */
export function toPortalDto(dto: CommunicationDto): Omit<CommunicationDto, 'customerVisible'> {
  const { customerVisible: _cv, ...rest } = dto;
  return rest;
}
