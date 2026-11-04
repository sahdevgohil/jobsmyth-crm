import mongoose from 'mongoose';
import { recordAudit } from '../../services/audit.js';
import { AppError } from '../../utils/errors.js';
import {
  CompanySettingsModel,
  type CompanySettingsDocument,
} from './company-settings.model.js';
import { LookupValueModel, type LookupType } from './lookup-value.model.js';

export type CompanySettingsDto = {
  id: string;
  legalName: string;
  displayName: string;
  address: {
    line1: string;
    line2: string;
    city: string;
    state: string;
    zip: string;
  };
  phone: string;
  email: string;
  website: string;
  licenseText: string;
  timezone: string;
  defaultWasteBp: number;
  defaultMarginBp: number;
  estimateExpiryDays: number;
  taxRates: Array<{ id: string; name: string; rateBp: number; isDefault: boolean }>;
  invoiceTermsText: string;
  proposalTermsText: string;
  invoiceAutoIssue: boolean;
  invoiceNumberPrefix: string;
  updatedAt: string;
};

export type LookupValueDto = {
  id: string;
  type: LookupType;
  key: string;
  label: string;
  order: number;
  isActive: boolean;
};

function toCompanyDto(doc: CompanySettingsDocument): CompanySettingsDto {
  return {
    id: doc._id.toString(),
    legalName: doc.legalName,
    displayName: doc.displayName,
    address: {
      line1: doc.address?.line1 ?? '',
      line2: doc.address?.line2 ?? '',
      city: doc.address?.city ?? '',
      state: doc.address?.state ?? '',
      zip: doc.address?.zip ?? '',
    },
    phone: doc.phone ?? '',
    email: doc.email ?? '',
    website: doc.website ?? '',
    licenseText: doc.licenseText ?? '',
    timezone: doc.timezone,
    defaultWasteBp: doc.defaultWasteBp,
    defaultMarginBp: doc.defaultMarginBp,
    estimateExpiryDays: doc.estimateExpiryDays,
    taxRates: (doc.taxRates ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      rateBp: t.rateBp,
      isDefault: t.isDefault,
    })),
    invoiceTermsText: doc.invoiceTermsText ?? '',
    proposalTermsText: doc.proposalTermsText ?? '',
    invoiceAutoIssue: doc.invoiceAutoIssue ?? false,
    invoiceNumberPrefix: doc.invoiceNumberPrefix ?? 'INV',
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export async function ensureCompanySettings(): Promise<CompanySettingsDocument> {
  const existing = await CompanySettingsModel.findOne();
  if (existing) {
    return existing;
  }
  return CompanySettingsModel.create({});
}

export async function getCompanySettings(): Promise<CompanySettingsDto> {
  const doc = await ensureCompanySettings();
  return toCompanyDto(doc);
}

export async function patchCompanySettings(input: {
  patch: Record<string, unknown>;
  actorId: string;
  requestId?: string;
  ip?: string;
}): Promise<CompanySettingsDto> {
  const doc = await ensureCompanySettings();
  const before = toCompanyDto(doc);

  const { address, ...rest } = input.patch as {
    address?: Partial<{
      line1: string;
      line2: string;
      city: string;
      state: string;
      zip: string;
    }>;
  } & Record<string, unknown>;

  Object.assign(doc, rest);
  if (address) {
    doc.address = {
      line1: address.line1 ?? doc.address?.line1 ?? '',
      line2: address.line2 ?? doc.address?.line2 ?? '',
      city: address.city ?? doc.address?.city ?? '',
      state: address.state ?? doc.address?.state ?? '',
      zip: address.zip ?? doc.address?.zip ?? '',
    };
  }
  await doc.save();

  await recordAudit({
    actorType: 'user',
    actorId: input.actorId,
    action: 'settings.company_updated',
    entityType: 'companySettings',
    entityId: doc._id.toString(),
    changes: { before, after: toCompanyDto(doc) },
    requestId: input.requestId,
    ip: input.ip,
  });

  return toCompanyDto(doc);
}

export async function listLookups(
  type: LookupType,
  includeInactive = false,
): Promise<LookupValueDto[]> {
  const filter: Record<string, unknown> = { type };
  if (!includeInactive) {
    filter.isActive = true;
  }
  const rows = await LookupValueModel.find(filter).sort({ order: 1, label: 1 });
  return rows.map((row) => ({
    id: row._id.toString(),
    type: row.type as LookupType,
    key: row.key,
    label: row.label,
    order: row.order,
    isActive: row.isActive,
  }));
}

export async function createLookup(input: {
  type: LookupType;
  key: string;
  label: string;
  order?: number;
  actorId: string;
  requestId?: string;
  ip?: string;
}): Promise<LookupValueDto> {
  const order =
    input.order ??
    ((await LookupValueModel.countDocuments({ type: input.type })) + 1) * 10;

  try {
    const row = await LookupValueModel.create({
      type: input.type,
      key: input.key,
      label: input.label,
      order,
      isActive: true,
    });

    await recordAudit({
      actorType: 'user',
      actorId: input.actorId,
      action: 'settings.lookup_created',
      entityType: 'lookupValue',
      entityId: row._id.toString(),
      changes: { type: input.type, key: input.key, label: input.label },
      requestId: input.requestId,
      ip: input.ip,
    });

    return {
      id: row._id.toString(),
      type: row.type as LookupType,
      key: row.key,
      label: row.label,
      order: row.order,
      isActive: row.isActive,
    };
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code: number }).code === 11000
    ) {
      throw new AppError({
        status: 409,
        code: 'LOOKUP_KEY_EXISTS',
        message: 'A lookup with this key already exists for the type.',
      });
    }
    throw error;
  }
}

export async function updateLookup(input: {
  type: LookupType;
  id: string;
  label?: string;
  order?: number;
  isActive?: boolean;
  actorId: string;
  requestId?: string;
  ip?: string;
}): Promise<LookupValueDto> {
  if (!mongoose.isValidObjectId(input.id)) {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Lookup not found.' });
  }
  const row = await LookupValueModel.findOne({ _id: input.id, type: input.type });
  if (!row) {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Lookup not found.' });
  }

  if (input.label !== undefined) row.label = input.label;
  if (input.order !== undefined) row.order = input.order;
  if (input.isActive !== undefined) row.isActive = input.isActive;
  await row.save();

  await recordAudit({
    actorType: 'user',
    actorId: input.actorId,
    action: 'settings.lookup_updated',
    entityType: 'lookupValue',
    entityId: row._id.toString(),
    changes: {
      label: row.label,
      order: row.order,
      isActive: row.isActive,
    },
    requestId: input.requestId,
    ip: input.ip,
  });

  return {
    id: row._id.toString(),
    type: row.type as LookupType,
    key: row.key,
    label: row.label,
    order: row.order,
    isActive: row.isActive,
  };
}
