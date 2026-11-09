export type AddressDto = {
  line1: string;
  line2: string;
  city: string;
  state: string;
  zip: string;
};

export type ContactDto = {
  name: string;
  role: string;
  phone: string;
  email: string;
};

export type CustomerDto = {
  id: string;
  type: 'individual' | 'business';
  firstName: string;
  lastName: string;
  companyName: string;
  email: string;
  phone: string;
  contacts: ContactDto[];
  mailingAddress: AddressDto;
  ownerId: string;
  notes: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PropertyDto = {
  id: string;
  customerId: string;
  address: AddressDto;
  propertyTypeKey: string;
  details: {
    stories: number | null;
    roofAgeYears: number | null;
    notes: string;
  };
  createdAt: string;
  updatedAt: string;
};
