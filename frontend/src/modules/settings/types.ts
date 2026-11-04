export type CompanySettings = {
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
  invoiceTermsText: string;
  proposalTermsText: string;
};

export type LookupValue = {
  id: string;
  type: string;
  key: string;
  label: string;
  order: number;
  isActive: boolean;
};
