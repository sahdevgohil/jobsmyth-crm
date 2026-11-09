export type EstimateStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired' | 'void';
export type LineItemKind = 'material' | 'labor' | 'other';

export type EstimateLineItem = {
  id: string;
  description: string;
  kind: LineItemKind;
  quantity: number;
  unit: string;
  unitCostCents: number;
  laborCostCents: number;
  materialCostCents: number;
  amountCents: number;
};

export type Estimate = {
  id: string;
  number: string;
  customerId: string;
  propertyId: string;
  inspectionId: string | null;
  measurementId: string | null;
  leadId: string | null;
  status: EstimateStatus;
  version: number;
  lineItems: EstimateLineItem[];
  discountCents: number;
  taxRateBps: number;
  taxCents: number;
  subtotalCents: number;
  totalCents: number;
  notes: string;
  validUntil: string | null;
  parentEstimateId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type StandardLineItem = {
  key: string;
  label: string;
  unit: string;
  unitCostCents: number;
  kind: LineItemKind;
  active: boolean;
};

export type EstimateCatalog = {
  taxRateBps: number;
  standardLineItems: StandardLineItem[];
};

export type PricingConfig = {
  taxRateBps: number;
  standardLineItems: StandardLineItem[];
  updatedAt: string;
};
