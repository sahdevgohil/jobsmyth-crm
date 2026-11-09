import { PERMISSIONS } from '../../src/config/permissions.js';
import { PriceCatalogModel } from '../../src/modules/pricing/pricing.model.js';
import { createEstimateFromQuote } from '../../src/modules/pricing/pricing.service.js';
import { MeasurementModel } from '../../src/modules/measurements/measurement.model.js';
import mongoose from 'mongoose';

export const CatalogModelRef = PriceCatalogModel;

/** Builds a draft-pricing "Better" estimate from a demo measurement. Returns false when the catalog is not installed. */
export async function createDemoEstimate(a: { adminId: string; companyId: string; customerId: string; propertyId: string; measurementId: string }): Promise<boolean> {
  const catalog = await PriceCatalogModel.findOne({ companyId: new mongoose.Types.ObjectId(a.companyId) }).sort({ version: -1 });
  const m = await MeasurementModel.findById(a.measurementId);
  if (!catalog || !m?.totalArea) return false;
  await createEstimateFromQuote(
    { userId: a.adminId, companyId: a.companyId, role: 'admin', permissions: [...PERMISSIONS] },
    {
      catalogId: catalog._id.toString(), customerId: a.customerId, propertyId: a.propertyId, measurementId: a.measurementId,
      notes: 'DEMO estimate built from a demo measurement. Draft, unapproved pricing.',
      quote: { package: 'better', squares: Math.round((m.totalArea / 100) * 100) / 100, pitch: m.pitch || undefined },
    },
  );
  return true;
}
