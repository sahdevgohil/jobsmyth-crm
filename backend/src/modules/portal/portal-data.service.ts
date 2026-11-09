import mongoose from 'mongoose';
import { AppError } from '../../utils/errors.js';
import { AfterSalesModel } from '../after-sales/after-sales.model.js';
import { toPortalDto as toPortalAfterSales } from '../after-sales/after-sales.service.js';
import { CommunicationModel } from '../communications/communication.model.js';
import { FileModel } from '../files/file.model.js';
import { InspectionModel } from '../inspections/inspection.model.js';
import { InvoiceModel, PaymentModel } from '../invoices/invoice.model.js';
import { ProjectModel } from '../projects/project.model.js';
import { ProposalModel } from '../proposals/proposal.model.js';

function notFound(entity: string): AppError {
  return new AppError({ status: 404, code: 'NOT_FOUND', message: `${entity} not found.` });
}

export async function listProposals(customerId: string) {
  const rows = await ProposalModel.find({
    customerId,
    status: { $ne: 'void' },
  })
    .sort({ createdAt: -1 })
    .select({
      number: 1,
      status: 1,
      totalCents: 1,
      expirationDate: 1,
      propertyId: 1,
      version: 1,
      createdAt: 1,
      updatedAt: 1,
      'signature.status': 1,
    });
  return rows.map((p) => ({
    id: p._id.toString(),
    number: p.number,
    status: p.status,
    totalCents: p.totalCents,
    expirationDate: p.expirationDate ? p.expirationDate.toISOString() : null,
    propertyId: p.propertyId.toString(),
    version: p.version,
    signatureStatus: p.signature?.status ?? 'not_requested',
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  }));
}

export async function getProposal(customerId: string, id: string) {
  if (!mongoose.isValidObjectId(id)) throw notFound('Proposal');
  const p = await ProposalModel.findOne({ _id: id, customerId, status: { $ne: 'void' } });
  if (!p) throw notFound('Proposal');
  return {
    id: p._id.toString(),
    number: p.number,
    status: p.status,
    propertyId: p.propertyId.toString(),
    version: p.version,
    lineItems: p.lineItems,
    discountCents: p.discountCents,
    taxRateBps: p.taxRateBps,
    taxCents: p.taxCents,
    subtotalCents: p.subtotalCents,
    totalCents: p.totalCents,
    termsAndConditions: p.termsAndConditions ?? '',
    paymentSchedule: p.paymentSchedule ?? [],
    expirationDate: p.expirationDate ? p.expirationDate.toISOString() : null,
    signature: {
      status: p.signature?.status ?? 'not_requested',
      signedAt: p.signature?.signedAt ? p.signature.signedAt.toISOString() : null,
    },
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export async function listProjects(customerId: string) {
  const rows = await ProjectModel.find({
    customerId,
    status: { $ne: 'cancelled' },
  })
    .sort({ createdAt: -1 })
    .select({
      number: 1,
      status: 1,
      propertyId: 1,
      plannedStartAt: 1,
      plannedEndAt: 1,
      actualStartAt: 1,
      actualEndAt: 1,
      createdAt: 1,
      updatedAt: 1,
    });
  return rows.map((p) => ({
    id: p._id.toString(),
    number: p.number,
    status: p.status,
    propertyId: p.propertyId.toString(),
    plannedStartAt: p.plannedStartAt ? p.plannedStartAt.toISOString() : null,
    plannedEndAt: p.plannedEndAt ? p.plannedEndAt.toISOString() : null,
    actualStartAt: p.actualStartAt ? p.actualStartAt.toISOString() : null,
    actualEndAt: p.actualEndAt ? p.actualEndAt.toISOString() : null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  }));
}

export async function getProject(customerId: string, id: string) {
  if (!mongoose.isValidObjectId(id)) throw notFound('Project');
  const p = await ProjectModel.findOne({ _id: id, customerId });
  if (!p) throw notFound('Project');
  return {
    id: p._id.toString(),
    number: p.number,
    status: p.status,
    priority: p.priority,
    propertyId: p.propertyId.toString(),
    plannedStartAt: p.plannedStartAt ? p.plannedStartAt.toISOString() : null,
    plannedEndAt: p.plannedEndAt ? p.plannedEndAt.toISOString() : null,
    actualStartAt: p.actualStartAt ? p.actualStartAt.toISOString() : null,
    actualEndAt: p.actualEndAt ? p.actualEndAt.toISOString() : null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export async function listInvoices(customerId: string) {
  const rows = await InvoiceModel.find({
    customerId,
    status: { $nin: ['void', 'draft'] },
  })
    .sort({ invoiceDate: -1 })
    .select({
      number: 1,
      status: 1,
      invoiceDate: 1,
      dueDate: 1,
      totalCents: 1,
      amountPaidCents: 1,
      projectId: 1,
      createdAt: 1,
    });
  return rows.map((inv) => ({
    id: inv._id.toString(),
    number: inv.number,
    status: inv.status,
    invoiceDate: inv.invoiceDate.toISOString(),
    dueDate: inv.dueDate ? inv.dueDate.toISOString() : null,
    totalCents: inv.totalCents,
    amountPaidCents: inv.amountPaidCents,
    balanceCents: Math.max(0, inv.totalCents - inv.amountPaidCents),
    projectId: inv.projectId ? inv.projectId.toString() : null,
    createdAt: inv.createdAt.toISOString(),
  }));
}

export async function getInvoice(customerId: string, id: string) {
  if (!mongoose.isValidObjectId(id)) throw notFound('Invoice');
  const inv = await InvoiceModel.findOne({
    _id: id,
    customerId,
    status: { $nin: ['void', 'draft'] },
  });
  if (!inv) throw notFound('Invoice');
  const payments = await PaymentModel.find({
    invoiceId: inv._id,
    status: 'recorded',
  }).sort({ paymentDate: -1 });
  return {
    id: inv._id.toString(),
    number: inv.number,
    status: inv.status,
    invoiceDate: inv.invoiceDate.toISOString(),
    dueDate: inv.dueDate ? inv.dueDate.toISOString() : null,
    lineItems: inv.lineItems,
    discountCents: inv.discountCents,
    taxCents: inv.taxCents,
    subtotalCents: inv.subtotalCents,
    totalCents: inv.totalCents,
    amountPaidCents: inv.amountPaidCents,
    balanceCents: Math.max(0, inv.totalCents - inv.amountPaidCents),
    projectId: inv.projectId ? inv.projectId.toString() : null,
    payments: payments.map((p) => ({
      id: p._id.toString(),
      amountCents: p.amountCents,
      paymentDate: p.paymentDate.toISOString(),
      method: p.method,
    })),
    createdAt: inv.createdAt.toISOString(),
  };
}

export async function listFiles(customerId: string) {
  const rows = await FileModel.find({
    customerId,
    visibility: 'customer',
  })
    .sort({ createdAt: -1 })
    .select({
      originalFilename: 1,
      mimeType: 1,
      sizeBytes: 1,
      category: 1,
      caption: 1,
      propertyId: 1,
      projectId: 1,
      createdAt: 1,
    });
  return rows.map((f) => ({
    id: f._id.toString(),
    originalFilename: f.originalFilename,
    mimeType: f.mimeType,
    sizeBytes: f.sizeBytes,
    category: f.category,
    caption: f.caption ?? '',
    propertyId: f.propertyId ? f.propertyId.toString() : null,
    projectId: f.projectId ? f.projectId.toString() : null,
    createdAt: f.createdAt.toISOString(),
  }));
}

export async function listInspections(customerId: string) {
  const rows = await InspectionModel.find({
    customerId,
    status: { $ne: 'cancelled' },
  })
    .sort({ inspectionDate: -1 })
    .select({
      propertyId: 1,
      inspectionDate: 1,
      status: 1,
      typeKey: 1,
      roofCondition: 1,
      findings: 1,
      recommendations: 1,
      createdAt: 1,
    });
  return rows.map((i) => ({
    id: i._id.toString(),
    propertyId: i.propertyId.toString(),
    inspectionDate: i.inspectionDate.toISOString(),
    status: i.status,
    typeKey: i.typeKey,
    roofCondition: i.roofCondition ?? '',
    findings: i.findings ?? '',
    recommendations: i.recommendations ?? '',
    createdAt: i.createdAt.toISOString(),
  }));
}

export async function listCommunications(customerId: string) {
  const rows = await CommunicationModel.find({
    customerId,
    customerVisible: true,
  })
    .sort({ createdAt: -1 })
    .limit(200);
  return rows.map((c) => ({
    id: c._id.toString(),
    channel: c.channel,
    direction: c.direction,
    subject: c.subject ?? '',
    body: c.body,
    deliveryStatus: c.deliveryStatus,
    createdAt: c.createdAt.toISOString(),
  }));
}

export async function listAfterSales(customerId: string) {
  const rows = await AfterSalesModel.find({ customerId }).sort({ createdAt: -1 });
  return rows.map((r) =>
    toPortalAfterSales({
      id: r._id.toString(),
      projectId: r.projectId.toString(),
      customerId: r.customerId.toString(),
      propertyId: r.propertyId ? r.propertyId.toString() : null,
      completionConfirmedAt: r.completionConfirmedAt
        ? r.completionConfirmedAt.toISOString()
        : null,
      completionConfirmedBy: r.completionConfirmedBy
        ? r.completionConfirmedBy.toString()
        : null,
      feedbackRating: r.feedbackRating ?? null,
      feedbackComment: r.feedbackComment ?? '',
      warrantyLookupKey: r.warrantyLookupKey ?? null,
      warrantyNotes: r.warrantyNotes ?? '',
      followUpDueAt: r.followUpDueAt ? r.followUpDueAt.toISOString() : null,
      followUpCompletedAt: r.followUpCompletedAt ? r.followUpCompletedAt.toISOString() : null,
      serviceHistoryNotes: r.serviceHistoryNotes ?? '',
      customerNotesVisible: r.customerNotesVisible ?? '',
      createdBy: r.createdBy.toString(),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }),
  );
}
