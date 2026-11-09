export type Customer = {
  id: string;
  type: 'individual' | 'business';
  firstName: string;
  lastName: string;
  companyName: string;
  email: string;
  phone: string;
  notes: string;
  ownerId: string;
  archivedAt: string | null;
  createdAt: string;
};

export type Property = {
  id: string;
  customerId: string;
  address: {
    line1: string;
    line2: string;
    city: string;
    state: string;
    zip: string;
  };
  propertyTypeKey: string;
  details?: { stories: number | null; roofAgeYears: number | null; notes: string };
};
