/** Storm history for CRM records (property, customer, lead, project), always from the record's own saved or geocoded address. */
import mongoose from 'mongoose';
import { recordAudit } from '../../services/audit.js';
import { AppError } from '../../utils/errors.js';
import { CustomerModel } from '../customers/customer.model.js';
import { PropertyModel } from '../customers/property.model.js';
import { LeadModel } from '../leads/lead.model.js';
import { ProjectModel } from '../projects/project.model.js';
import { validLatLng } from './geo.js';
import { geocodeAddress, geocoderConfigFromEnv, type GeocoderConfig } from './storm.geocode.js';
import { DAMAGE_DISCLAIMER, searchNear, type EventFilters } from './storm.search.js';
import { companyCustomerIds, type StormCtx } from './storm.zones.js';

type Addr = { line1?: string | null; city?: string | null; state?: string | null; zip?: string | null };
const addrString = (a: Addr | undefined | null): string => [a?.line1, a?.city, [a?.state, a?.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
const nf = (m: string): AppError => new AppError({ status: 404, code: 'NOT_FOUND', message: m });

export type HistoryLocation = {
  label: string;
  propertyId: string | null;
  point: { lat: number; lng: number } | null;
  locationSource: 'saved' | 'geocoded' | 'unavailable';
  accuracy: string | null;
  unavailableReason: string | null;
  result: Awaited<ReturnType<typeof searchNear>> | null;
};

async function assertCustomer(ctx: StormCtx, customerId: mongoose.Types.ObjectId | string): Promise<void> {
  const inCompany = (await companyCustomerIds(ctx.companyId)).some((c) => c.toString() === String(customerId));
  if (!inCompany) throw nf('Record not found.');
  if (ctx.role !== 'admin') {
    const c = await CustomerModel.findById(customerId).select('ownerId').lean();
    if (!c || c.ownerId.toString() !== ctx.userId) throw nf('Record not found.');
  }
}

async function locate(ctx: StormCtx, prop: { _id: mongoose.Types.ObjectId; address?: Addr | null; location?: { lat?: number | null; lng?: number | null } | null }, geo: GeocoderConfig): Promise<Pick<HistoryLocation, 'point' | 'locationSource' | 'accuracy' | 'unavailableReason'>> {
  const lat = prop.location?.lat;
  const lng = prop.location?.lng;
  if (lat != null && lng != null && validLatLng(lat, lng)) return { point: { lat, lng }, locationSource: 'saved', accuracy: 'saved property location', unavailableReason: null };
  const s = addrString(prop.address);
  if (!s) return { point: null, locationSource: 'unavailable', accuracy: null, unavailableReason: 'This property has no address.' };
  try {
    const g = await geocodeAddress(s, geo);
    if (!g.precise) return { point: null, locationSource: 'unavailable', accuracy: g.accuracy, unavailableReason: 'The address could only be matched approximately, so no distance is shown. Correct the address and try again.' };
    await PropertyModel.updateOne({ _id: prop._id, 'location.lat': { $exists: false } }, { $set: { location: { lat: g.latitude, lng: g.longitude } } });
    await recordAudit({ actorType: 'user', actorId: ctx.userId, action: 'property.geocoded_for_storm_history', entityType: 'property', entityId: prop._id.toString(), changes: { provider: g.provider, accuracy: g.accuracy }, requestId: ctx.requestId, ip: ctx.ip }).catch(() => undefined);
    return { point: { lat: g.latitude, lng: g.longitude }, locationSource: 'geocoded', accuracy: g.accuracy === 'rooftop' ? 'rooftop' : 'street-address estimate', unavailableReason: null };
  } catch (err) {
    return { point: null, locationSource: 'unavailable', accuracy: null, unavailableReason: err instanceof AppError ? err.message : 'The address could not be located.' };
  }
}

export async function historyFor(ctx: StormCtx, input: { propertyId?: string; customerId?: string; leadId?: string; projectId?: string; radiusMiles: number } & EventFilters, geo: GeocoderConfig = geocoderConfigFromEnv()) {
  const props: Array<{ _id: mongoose.Types.ObjectId; address?: Addr | null; location?: { lat?: number | null; lng?: number | null } | null; customerId: mongoose.Types.ObjectId }> = [];
  let leadLocation: { label: string; address: string } | null = null;
  if (input.propertyId) {
    if (!mongoose.isValidObjectId(input.propertyId)) throw nf('Property not found.');
    const p = await PropertyModel.findById(input.propertyId).lean();
    if (!p) throw nf('Property not found.');
    await assertCustomer(ctx, p.customerId);
    props.push(p as never);
  } else if (input.projectId) {
    if (!mongoose.isValidObjectId(input.projectId)) throw nf('Project not found.');
    const pr = await ProjectModel.findById(input.projectId).select('propertyId customerId').lean();
    if (!pr) throw nf('Project not found.');
    await assertCustomer(ctx, pr.customerId);
    const p = await PropertyModel.findById(pr.propertyId).lean();
    if (p) props.push(p as never);
  } else if (input.customerId) {
    if (!mongoose.isValidObjectId(input.customerId)) throw nf('Customer not found.');
    await assertCustomer(ctx, input.customerId);
    props.push(...((await PropertyModel.find({ customerId: input.customerId }).limit(5).lean()) as never[]));
  } else if (input.leadId) {
    if (!mongoose.isValidObjectId(input.leadId)) throw nf('Lead not found.');
    const l = await LeadModel.findById(input.leadId).lean();
    if (!l || (ctx.role !== 'admin' && l.assignedTo.toString() !== ctx.userId)) throw nf('Lead not found.');
    const a = addrString(l.address as Addr);
    leadLocation = { label: a || 'Lead address', address: a };
  } else throw new AppError({ status: 400, code: 'VALIDATION_ERROR', message: 'Give a property, customer, lead or project.' });

  const locations: HistoryLocation[] = [];
  for (const p of props) {
    const loc = await locate(ctx, p, geo);
    locations.push({
      label: addrString(p.address) || 'Property', propertyId: p._id.toString(), ...loc,
      result: loc.point ? await searchNear({ ...input, lat: loc.point.lat, lng: loc.point.lng, radiusMiles: input.radiusMiles, sort: 'newest', pageSize: 15 }) : null,
    });
  }
  if (leadLocation) {
    let point: { lat: number; lng: number } | null = null;
    let reason: string | null = null;
    let accuracy: string | null = null;
    if (!leadLocation.address) reason = 'This lead has no address.';
    else {
      try {
        const g = await geocodeAddress(leadLocation.address, geo);
        if (g.precise) { point = { lat: g.latitude, lng: g.longitude }; accuracy = g.accuracy === 'rooftop' ? 'rooftop' : 'street-address estimate'; }
        else reason = 'The address could only be matched approximately, so no distance is shown.';
      } catch (err) { reason = err instanceof AppError ? err.message : 'The address could not be located.'; }
    }
    locations.push({ label: leadLocation.label, propertyId: null, point, locationSource: point ? 'geocoded' : 'unavailable', accuracy, unavailableReason: reason, result: point ? await searchNear({ ...input, lat: point.lat, lng: point.lng, radiusMiles: input.radiusMiles, sort: 'newest', pageSize: 15 }) : null });
  }
  return { radiusMiles: input.radiusMiles, locations, disclaimer: DAMAGE_DISCLAIMER, note: 'Distances use the property address, not anyone\'s current location.' };
}
