import { recordAudit } from '../../services/audit.js';
import { AppError } from '../../utils/errors.js';
import { type LineItemKind } from './company-settings.model.js';
import { ensureCompanySettings } from './settings.service.js';

export type StandardLineItemDto = {
  key: string;
  label: string;
  unit: string;
  unitCostCents: number;
  kind: LineItemKind;
  active: boolean;
};

export type PricingConfigDto = {
  taxRateBps: number;
  standardLineItems: StandardLineItemDto[];
  updatedAt: string;
};

export async function getPricingConfig(): Promise<PricingConfigDto> {
  const doc = await ensureCompanySettings();
  return {
    taxRateBps: doc.taxRateBps ?? 0,
    standardLineItems: (doc.standardLineItems ?? []).map((item) => ({
      key: item.key,
      label: item.label,
      unit: item.unit,
      unitCostCents: item.unitCostCents,
      kind: item.kind as LineItemKind,
      active: item.active,
    })),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export async function patchPricingConfig(input: {
  patch: { taxRateBps?: number; standardLineItems?: StandardLineItemDto[] };
  actorId: string;
  requestId?: string;
  ip?: string;
}): Promise<PricingConfigDto> {
  const { patch } = input;
  if (patch.standardLineItems) {
    const seen = new Set<string>();
    patch.standardLineItems.forEach((item, index) => {
      if (seen.has(item.key)) {
        throw new AppError({
          status: 400,
          code: 'VALIDATION_ERROR',
          message: 'Standard line item keys must be unique.',
          details: [{ path: `standardLineItems.${index}.key`, message: 'Duplicate key' }],
        });
      }
      seen.add(item.key);
    });
  }

  const before = await getPricingConfig();
  const doc = await ensureCompanySettings();
  if (patch.taxRateBps !== undefined) doc.taxRateBps = patch.taxRateBps;
  if (patch.standardLineItems) doc.set('standardLineItems', patch.standardLineItems);
  await doc.save();
  const after = await getPricingConfig();

  await recordAudit({
    actorType: 'user',
    actorId: input.actorId,
    action: 'settings.pricing_updated',
    entityType: 'companySettings',
    entityId: doc._id.toString(),
    changes: { before, after },
    requestId: input.requestId,
    ip: input.ip,
  });

  return after;
}
