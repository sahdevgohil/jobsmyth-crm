import mongoose from 'mongoose';
import { CompanySettingsModel } from '../settings/company-settings.model.js';
import { CompanyModel, type CompanyDocument } from './company.model.js';

/** The company that owns every record created before multi-company support. Created on first use. */
export async function ensureDefaultCompany(): Promise<CompanyDocument> {
  const existing = await CompanyModel.findOne({ isDefault: true });
  if (existing) return existing;
  const settings = await CompanySettingsModel.findOne().select({ displayName: 1, timezone: 1 });
  const name = settings?.displayName || 'Legacy Construction Group LLC';
  try {
    return await CompanyModel.create({
      name,
      slug: 'default',
      isDefault: true,
      timezone: settings?.timezone ?? 'America/Chicago',
      branding: { displayName: name },
    });
  } catch (err) {
    // Concurrent first requests: another request created it.
    const raced = await CompanyModel.findOne({ isDefault: true });
    if (raced) return raced;
    throw err;
  }
}

export async function getCompany(companyId: string): Promise<CompanyDocument | null> {
  if (!mongoose.isValidObjectId(companyId)) return null;
  return CompanyModel.findById(companyId);
}
