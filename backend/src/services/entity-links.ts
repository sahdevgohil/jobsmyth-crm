import mongoose from 'mongoose';
import type { Role } from '../config/permissions.js';
import { CustomerModel } from '../modules/customers/customer.model.js';
import { PropertyModel } from '../modules/customers/property.model.js';
import { InspectionModel, type InspectionDocument } from '../modules/inspections/inspection.model.js';
import { inspectionScopeFilter } from '../modules/inspections/inspection.service.js';
import { LeadModel } from '../modules/leads/lead.model.js';
import { AppError } from '../utils/errors.js';

export type AuthContext = { userId: string; role: Role };

export function validationError(path: string, message: string): AppError {
  return new AppError({
    status: 400,
    code: 'VALIDATION_ERROR',
    message,
    details: [{ path, message }],
  });
}

/**
 * Scope for records that hang off a customer and optionally an inspection
 * (measurements, estimates). Admins see everything; salespeople see records for
 * customers they own, or linked to an inspection assigned to them.
 */
export async function customerOrInspectionScopeFilter(
  auth: AuthContext,
): Promise<Record<string, unknown>> {
  if (auth.role === 'admin') return {};
  const [ownedCustomerIds, assignedInspectionIds] = await Promise.all([
    CustomerModel.find({ ownerId: auth.userId }).distinct('_id'),
    InspectionModel.find({ assignedTo: auth.userId }).distinct('_id'),
  ]);
  return {
    $or: [
      { customerId: { $in: ownedCustomerIds } },
      { inspectionId: { $in: assignedInspectionIds } },
    ],
  };
}

/**
 * Resolves and authorises the customer/property (and optional inspection) a new record is
 * attached to. The customer is always derived from the property; if `customerId` is supplied
 * it must match.
 */
export async function resolveCustomerPropertyTarget(
  auth: AuthContext,
  input: { customerId?: string; propertyId: string; inspectionId?: string },
): Promise<{
  customerId: mongoose.Types.ObjectId;
  propertyId: mongoose.Types.ObjectId;
  inspection: InspectionDocument | null;
}> {
  const property = mongoose.isValidObjectId(input.propertyId)
    ? await PropertyModel.findById(input.propertyId)
    : null;
  if (!property) throw validationError('propertyId', 'Property not found');
  if (input.customerId && property.customerId.toString() !== input.customerId) {
    throw validationError('propertyId', 'Property does not belong to this customer');
  }
  const customer = await CustomerModel.findById(property.customerId);
  if (!customer) throw validationError('customerId', 'Customer not found');

  let inspection: InspectionDocument | null = null;
  if (input.inspectionId) {
    const scope = await inspectionScopeFilter(auth);
    inspection = mongoose.isValidObjectId(input.inspectionId)
      ? await InspectionModel.findOne({ _id: input.inspectionId, ...scope })
      : null;
    if (!inspection) throw validationError('inspectionId', 'Inspection not found');
    if (inspection.propertyId.toString() !== property._id.toString()) {
      throw validationError('inspectionId', 'Inspection belongs to a different property');
    }
  }

  if (auth.role !== 'admin') {
    const owns = customer.ownerId.toString() === auth.userId;
    if (!owns && !inspection) throw validationError('customerId', 'Customer not found');
  }

  return { customerId: customer._id, propertyId: property._id, inspection };
}

export async function assertLeadLink(auth: AuthContext, leadId: string): Promise<void> {
  const filter: Record<string, unknown> = { _id: leadId };
  if (auth.role !== 'admin') filter.assignedTo = auth.userId;
  const exists = mongoose.isValidObjectId(leadId) ? await LeadModel.exists(filter) : null;
  if (!exists) throw validationError('leadId', 'Lead not found');
}
