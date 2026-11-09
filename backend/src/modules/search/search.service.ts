import type { AuthContext } from '../../services/entity-links.js';
import { customerOrInspectionScopeFilter } from '../../services/entity-links.js';
import { escapeRegex } from '../../utils/escape-regex.js';
import { AppointmentModel } from '../appointments/appointment.model.js';
import { CustomerModel } from '../customers/customer.model.js';
import { PropertyModel } from '../customers/property.model.js';
import { EstimateModel } from '../estimates/estimate.model.js';
import { InspectionModel } from '../inspections/inspection.model.js';
import { InvoiceModel } from '../invoices/invoice.model.js';
import { LeadModel } from '../leads/lead.model.js';
import { ProjectModel } from '../projects/project.model.js';
import { ProposalModel } from '../proposals/proposal.model.js';
import { SubcontractorModel } from '../subcontractors/subcontractor.model.js';

export type SearchHit = {
  entityType: string;
  id: string;
  label: string;
  href: string;
};

export async function globalSearch(input: {
  auth: AuthContext;
  q: string;
  limit?: number;
}): Promise<SearchHit[]> {
  const raw = input.q.trim();
  if (raw.length < 2) return [];
  const q = escapeRegex(raw);
  const rx = { $regex: q, $options: 'i' };
  const limit = Math.min(input.limit ?? 8, 20);
  const scope = await customerOrInspectionScopeFilter(input.auth);
  const isAdmin = input.auth.role === 'admin';

  const ownedCustomers = isAdmin
    ? null
    : await CustomerModel.find({ ownerId: input.auth.userId }).distinct('_id');

  const leadFilter = isAdmin
    ? { $or: [{ firstName: rx }, { lastName: rx }, { companyName: rx }, { phone: rx }, { email: rx }] }
    : {
        assignedTo: input.auth.userId,
        $or: [{ firstName: rx }, { lastName: rx }, { companyName: rx }, { phone: rx }, { email: rx }],
      };

  const customerFilter = isAdmin
    ? { $or: [{ firstName: rx }, { lastName: rx }, { companyName: rx }, { phone: rx }, { email: rx }] }
    : {
        ownerId: input.auth.userId,
        $or: [{ firstName: rx }, { lastName: rx }, { companyName: rx }, { phone: rx }, { email: rx }],
      };

  const [
    leads,
    customers,
    properties,
    appointments,
    inspections,
    estimates,
    proposals,
    projects,
    invoices,
    subcontractors,
  ] = await Promise.all([
    LeadModel.find(leadFilter).limit(limit).select({ firstName: 1, lastName: 1, companyName: 1 }),
    CustomerModel.find(customerFilter)
      .limit(limit)
      .select({ firstName: 1, lastName: 1, companyName: 1 }),
    PropertyModel.find(
      isAdmin
        ? { 'address.line1': rx }
        : { customerId: { $in: ownedCustomers ?? [] }, 'address.line1': rx },
    )
      .limit(limit)
      .select({ address: 1 }),
    AppointmentModel.find(
      isAdmin
        ? { title: rx }
        : {
            $or: [{ assignedTo: input.auth.userId }, { createdBy: input.auth.userId }],
            title: rx,
          },
    )
      .limit(limit)
      .select({ title: 1 }),
    InspectionModel.find({ $and: [scope, { $or: [{ findings: rx }, { notes: rx }] }] })
      .limit(limit)
      .select({ status: 1, findings: 1 }),
    EstimateModel.find({ $and: [scope, { number: rx }] }).limit(limit).select({ number: 1 }),
    ProposalModel.find({ $and: [scope, { number: rx }] }).limit(limit).select({ number: 1 }),
    ProjectModel.find({ $and: [scope, { number: rx }] }).limit(limit).select({ number: 1 }),
    InvoiceModel.find({ $and: [scope, { number: rx }] }).limit(limit).select({ number: 1 }),
    isAdmin
      ? SubcontractorModel.find({ companyName: rx, active: true })
          .limit(limit)
          .select({ companyName: 1 })
      : Promise.resolve([]),
  ]);

  const hits: SearchHit[] = [];
  for (const l of leads) {
    hits.push({
      entityType: 'lead',
      id: l._id.toString(),
      label: l.companyName || `${l.firstName} ${l.lastName}`.trim() || l._id.toString(),
      href: `/app/leads/${l._id.toString()}`,
    });
  }
  for (const c of customers) {
    hits.push({
      entityType: 'customer',
      id: c._id.toString(),
      label: c.companyName || `${c.firstName} ${c.lastName}`.trim() || c._id.toString(),
      href: `/app/customers/${c._id.toString()}`,
    });
  }
  for (const p of properties) {
    hits.push({
      entityType: 'property',
      id: p._id.toString(),
      label: p.address?.line1 || p._id.toString(),
      href: `/app/properties/${p._id.toString()}`,
    });
  }
  for (const a of appointments) {
    hits.push({
      entityType: 'appointment',
      id: a._id.toString(),
      label: a.title,
      href: `/app/appointments/${a._id.toString()}`,
    });
  }
  for (const i of inspections) {
    hits.push({
      entityType: 'inspection',
      id: i._id.toString(),
      label: `Inspection (${i.status})`,
      href: `/app/inspections/${i._id.toString()}`,
    });
  }
  for (const e of estimates) {
    hits.push({
      entityType: 'estimate',
      id: e._id.toString(),
      label: e.number,
      href: `/app/estimates/${e._id.toString()}`,
    });
  }
  for (const p of proposals) {
    hits.push({
      entityType: 'proposal',
      id: p._id.toString(),
      label: p.number,
      href: `/app/proposals/${p._id.toString()}`,
    });
  }
  for (const p of projects) {
    hits.push({
      entityType: 'project',
      id: p._id.toString(),
      label: p.number,
      href: `/app/projects/${p._id.toString()}`,
    });
  }
  for (const inv of invoices) {
    hits.push({
      entityType: 'invoice',
      id: inv._id.toString(),
      label: inv.number,
      href: `/app/invoices/${inv._id.toString()}`,
    });
  }
  for (const s of subcontractors) {
    hits.push({
      entityType: 'subcontractor',
      id: s._id.toString(),
      label: s.companyName,
      href: `/app/subcontractors`,
    });
  }
  return hits.slice(0, limit * 2);
}
