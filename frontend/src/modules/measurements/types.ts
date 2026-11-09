export type MeasurementSource = 'manual' | 'import' | 'external' | 'google_solar';
export type MeasurementProvider = 'none' | 'roofr' | 'eagleview' | 'hover' | 'google_solar';
export type MeasurementProviderStatus = 'not_configured' | 'manual_only' | 'connected';
export type MeasurementUnits = 'sq_ft' | 'squares' | 'sq_m';

export type SolarSegment = {
  id: string;
  areaSqFt: number;
  squares: number;
  pitchDegrees: number;
  pitchLabel: string;
  azimuthDegrees: number;
  compass: string;
  center: { latitude: number; longitude: number } | null;
  boundingBox: { sw: { latitude: number; longitude: number }; ne: { latitude: number; longitude: number } } | null;
  planeHeightM: number | null;
};

export type SolarEdge = { id: string; type: string; lengthFt: number | null; source: string; confidence: string; verification: string; note: string };

export type SolarAutomated = {
  provider: string;
  areaSqFt: number;
  squares: number;
  segmentCount: number;
  predominantPitch: string;
  predominantPitchDegrees: number;
  dominantOrientation: string;
  pitchDistribution: Array<{ pitch: string; segmentCount: number; areaSqFt: number; percent: number }>;
  segments: SolarSegment[];
  imagery: { date: string | null; processedDate: string | null; quality: string | null };
  warnings: string[];
  requestedAt?: string;
  attribution?: string;
};

export type SolarDetail = {
  isDemo: boolean;
  revision: number;
  supersedesId: string | null;
  supersededById: string | null;
  automated: SolarAutomated | null;
  fieldSources: Record<string, string>;
  verified: Record<string, boolean>;
  edges: SolarEdge[] | null;
  counts: Record<string, number | string>;
  corrections: Array<{ field: string; original: unknown; updated: unknown; userId: string; at: string; reason: string }>;
  reportFileId: string | null;
};

export type Measurement = {
  solar?: SolarDetail | null;
  id: string;
  propertyId: string;
  inspectionId: string | null;
  customerId: string;
  source: MeasurementSource;
  provider: MeasurementProvider;
  providerStatus: MeasurementProviderStatus;
  measurementDate: string;
  units: MeasurementUnits;
  totalArea: number | null;
  facets: number | null;
  pitch: string;
  ridge: number | null;
  hip: number | null;
  valley: number | null;
  eave: number | null;
  rake: number | null;
  notes: string;
  importedFilename: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type IntegrationStatus = {
  providers: Array<{ id: string; status: string; message: string }>;
};
