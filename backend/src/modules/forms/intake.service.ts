/**
 * Customer intake: one submission of the company's `customer_intake` form becomes the customer, the
 * property and the lead (data reuse — nothing is retyped), with contact consent recorded per channel.
 */
import mongoose from 'mongoose';
import { AppError } from '../../utils/errors.js';
import { CustomerModel } from '../customers/customer.model.js';
import * as customerService from '../customers/customer.service.js';
import * as leadService from '../leads/lead.service.js';
import { LookupValueModel } from '../settings/lookup-value.model.js';
import { UserModel } from '../users/user.model.js';
import { ensureDefaultCompany } from '../companies/company.service.js';
import { CONSENT_WORDING } from './default-templates.js';
import type { Answers } from './engine.js';
import { FormSubmissionModel } from './form.model.js';
import * as forms from './form.service.js';
import type { FormCtx, SubmissionDto } from './form.service.js';

/** Intake option values → existing lookup keys used by leads and properties. */
const SOURCE_MAP: Record<string, { key: string; label: string }> = {
  door_knock: { key: 'door_knocking', label: 'Door knocking' },
  referral: { key: 'referral', label: 'Referral' },
  website: { key: 'website', label: 'Website' },
  google: { key: 'google', label: 'Google' },
  social: { key: 'social', label: 'Social' },
  yard_sign: { key: 'yard_sign', label: 'Yard sign' },
  repeat_customer: { key: 'existing_customer', label: 'Existing customer' },
  other: { key: 'other', label: 'Other' },
};
const SERVICE_MAP: Record<string, { key: string; label: string }> = {
  roofing: { key: 'roofing', label: 'Roofing' },
  remodeling: { key: 'remodeling', label: 'Remodeling' },
  gutters: { key: 'gutters', label: 'Gutters' },
  siding: { key: 'siding', label: 'Siding' },
  windows: { key: 'windows', label: 'Windows' },
  paint: { key: 'paint', label: 'Paint' },
  other: { key: 'general_construction', label: 'General construction' },
};
const PROPERTY_TYPE_LABEL: Record<string, string> = { single_family: 'Single-family', multi_family: 'Multi-family', commercial: 'Commercial', hoa: 'HOA' };

async function ensureLookup(type: string, key: string, label: string): Promise<void> {
  await LookupValueModel.updateOne({ type, key }, { $setOnInsert: { type, key, label, order: 100, isActive: true } }, { upsert: true });
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const addr = (v: unknown): { line1: string; city: string; state: string; zip: string; lat?: number; lng?: number } => {
  const a = (v ?? {}) as Record<string, unknown>;
  return { line1: str(a.line1), city: str(a.city), state: str(a.state) || 'TX', zip: str(a.zip), lat: typeof a.lat === 'number' ? a.lat : undefined, lng: typeof a.lng === 'number' ? a.lng : undefined };
};

export type IntakeResult = { created: boolean; customerId: string; propertyId: string; leadId: string; submission: SubmissionDto };

export async function submitIntake(
  ctx: FormCtx,
  input: { clientId: string; templateVersion?: number; answers: Answers; force?: boolean; requestId?: string; ip?: string },
): Promise<IntakeResult> {
  // Idempotent retry: an intake that already produced a customer returns it unchanged.
  const prior = await FormSubmissionModel.findOne({ companyId: new mongoose.Types.ObjectId(ctx.companyId), clientId: input.clientId });
  if (prior?.customerId && prior.status === 'completed' && prior.propertyId && prior.leadId) {
    return { created: false, customerId: prior.customerId.toString(), propertyId: prior.propertyId.toString(), leadId: prior.leadId.toString(), submission: await forms.getSubmission(ctx, prior._id.toString()) };
  }

  const { submission } = await forms.createSubmission(ctx, { clientId: input.clientId, templateKey: 'customer_intake', templateVersion: input.templateVersion, answers: input.answers, requestId: input.requestId, ip: input.ip });
  // Re-validate as complete (required fields) before creating anything.
  const a = input.answers;
  const issues: Array<{ path: string; message: string }> = [];
  const require = (id: string, ok: boolean, message: string): void => { if (!ok) issues.push({ path: id, message }); };
  const property = addr(a.property_address);
  require('property_address', property.line1 !== '' && property.zip !== '', 'Property street address and ZIP are required.');
  for (const id of ['first_name', 'last_name', 'mobile_phone', 'email', 'owner_or_renter', 'property_type', 'reason_for_call', 'lead_source', 'assigned_rep']) require(id, str(a[id]) !== '', 'This field is required.');
  const services = Array.isArray(a.services) ? (a.services as string[]) : [];
  require('services', services.length > 0, 'Choose at least one service.');
  if (issues.length > 0) throw new AppError({ status: 422, code: 'VALIDATION_ERROR', message: 'The intake form is not complete.', details: issues });

  // Assigned representative must be an active user of this company; salespeople may only assign themselves.
  const repId = str(a.assigned_rep);
  const rep = mongoose.isValidObjectId(repId) ? await UserModel.findById(repId).select({ isActive: 1, companyId: 1 }).lean() : null;
  const repCompany = rep ? (rep.companyId ? rep.companyId.toString() : (await ensureDefaultCompany())._id.toString()) : null;
  if (!rep || !rep.isActive || repCompany !== ctx.companyId) throw new AppError({ status: 422, code: 'VALIDATION_ERROR', message: 'Choose an active representative.', details: [{ path: 'assigned_rep', message: 'Unknown representative' }] });
  if (ctx.role !== 'admin' && repId !== ctx.userId) throw new AppError({ status: 403, code: 'FORBIDDEN', message: 'You can only assign intake to yourself.' });

  // Duplicate prevention (same company only), unless the user confirms.
  if (!input.force) {
    const matches = await customerService.findDuplicateMatches({ phone: str(a.mobile_phone), email: str(a.email), address: { line1: property.line1, zip: property.zip } });
    const sameCompany: typeof matches = [];
    for (const m of matches) {
      const owner = m.entityType === 'customer' ? (await CustomerModel.findById(m.id).select({ ownerId: 1 }).lean())?.ownerId : (await (await import('../leads/lead.model.js')).LeadModel.findById(m.id).select({ assignedTo: 1 }).lean())?.assignedTo;
      const u = owner ? await UserModel.findById(owner).select({ companyId: 1 }).lean() : null;
      const company = u?.companyId ? u.companyId.toString() : (await ensureDefaultCompany())._id.toString();
      if (u && company === ctx.companyId && (ctx.role === 'admin' || owner?.toString() === ctx.userId)) sameCompany.push(m);
    }
    if (sameCompany.length > 0) throw new AppError({ status: 409, code: 'DUPLICATE_FOUND', message: 'A matching customer or lead already exists.', details: sameCompany.map((m) => ({ path: `${m.entityType}:${m.id}`, message: m.label })) });
  }

  const source = SOURCE_MAP[str(a.lead_source)] ?? SOURCE_MAP.other!;
  const service = SERVICE_MAP[services[0] ?? 'other'] ?? SERVICE_MAP.other!;
  const propertyType = str(a.property_type);
  await ensureLookup('lead_source', source.key, source.label);
  await ensureLookup('project_category', service.key, service.label);
  await ensureLookup('property_type', propertyType, PROPERTY_TYPE_LABEL[propertyType] ?? propertyType);

  const mailing = a.mailing_address ? addr(a.mailing_address) : property;
  const auth = { userId: ctx.userId, role: ctx.role };
  const session = await mongoose.startSession();
  let customerId = '';
  let propertyId = '';
  let leadId = '';
  try {
    session.startTransaction();
    const customer = await customerService.createCustomer({
      auth: { ...auth, role: 'admin' },
      type: 'individual',
      firstName: str(a.first_name),
      lastName: str(a.last_name),
      email: str(a.email),
      phone: str(a.mobile_phone),
      mailingAddress: { line1: mailing.line1, city: mailing.city, state: mailing.state, zip: mailing.zip },
      notes: str(a.notes),
      ownerId: repId,
      requestId: input.requestId,
      ip: input.ip,
      session,
    });
    customerId = customer.id;
    const prop = await customerService.createProperty({
      auth: { ...auth, role: 'admin' },
      customerId,
      address: { line1: property.line1, city: property.city, state: property.state, zip: property.zip },
      propertyTypeKey: propertyType,
      details: { notes: [str(a.owner_or_renter) === 'renter' ? 'Renter' : 'Owner', str(a.hoa_name) && `HOA: ${str(a.hoa_name)}`, str(a.hoa_contact) && `HOA contact: ${str(a.hoa_contact)}`].filter(Boolean).join(' · ') },
      requestId: input.requestId,
      ip: input.ip,
      session,
    });
    propertyId = prop.id;
    if (property.lat !== undefined && property.lng !== undefined) {
      await (await import('../customers/property.model.js')).PropertyModel.updateOne({ _id: propertyId }, { $set: { location: { lat: property.lat, lng: property.lng } } }, { session });
    }
    const lead = await leadService.createLead({
      auth: { ...auth, role: 'admin' },
      firstName: str(a.first_name),
      lastName: str(a.last_name),
      email: str(a.email),
      phone: str(a.mobile_phone),
      address: { line1: property.line1, city: property.city, state: property.state, zip: property.zip },
      sourceKey: source.key,
      serviceInterestKey: service.key,
      notes: [str(a.notes), str(a.referred_by) && `Referred by: ${str(a.referred_by)}`, `Reason for call: ${str(a.reason_for_call).replace(/_/g, ' ')}`, services.length > 1 ? `Services: ${services.join(', ')}` : ''].filter(Boolean).join('\n'),
      assignedTo: repId,
      notify: false,
      requestId: input.requestId,
      ip: input.ip,
      session,
    });
    leadId = lead.id;

    // Consent is recorded only when the representative actually asked: an unanswered question is NOT consent.
    const now = new Date();
    const consent: Record<string, unknown> = {};
    if (typeof a.consent_text === 'boolean') consent['consent.sms'] = { granted: a.consent_text, at: now, source: 'intake_form', wording: CONSENT_WORDING.sms, wordingVersion: CONSENT_WORDING.version };
    if (typeof a.consent_email === 'boolean') consent['consent.email'] = { granted: a.consent_email, at: now, source: 'intake_form', wording: CONSENT_WORDING.email, wordingVersion: CONSENT_WORDING.version };
    await CustomerModel.updateOne(
      { _id: customerId },
      { $set: { ...consent, preferredContact: ({ call: 'call', text: 'text', email: 'email' } as Record<string, string>)[str(a.preferred_contact)] ?? '', bestTimeToReach: str(a.best_time), secondContactName: str(a.second_contact) } },
      { session },
    );
    await session.commitTransaction();
  } catch (err) {
    await session.abortTransaction().catch(() => undefined);
    throw err;
  } finally {
    await session.endSession();
  }

  // Link and complete the stored submission (answers keep the consent wording version shown).
  await forms.updateSubmission(ctx, submission.id, { answers: input.answers, links: { customerId, propertyId, leadId } });
  const consentStamp = { at: new Date(), source: 'intake_form', wordingVersion: CONSENT_WORDING.version };
  await FormSubmissionModel.updateOne({ _id: submission.id }, { $set: { ...(typeof a.consent_text === 'boolean' ? { 'consent.sms': { granted: a.consent_text, wording: CONSENT_WORDING.sms, recordedBy: ctx.userId, ...consentStamp } } : {}), ...(typeof a.consent_email === 'boolean' ? { 'consent.email': { granted: a.consent_email, wording: CONSENT_WORDING.email, recordedBy: ctx.userId, ...consentStamp } } : {}) } });
  const done = await forms.completeSubmission(ctx, submission.id, {});
  return { created: true, customerId, propertyId, leadId, submission: done };
}
