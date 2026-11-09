import type { Pt } from './raster.js';

export const GEOMETRY_EDGE_TYPES = ['ridge', 'hip', 'valley', 'eave', 'rake', 'wall_flashing', 'step_flashing', 'curb_flashing', 'transition', 'parapet', 'unspecified'] as const;
export type GeometryEdgeType = (typeof GEOMETRY_EDGE_TYPES)[number];

export const EDGE_TYPE_LABEL: Record<GeometryEdgeType, string> = {
  ridge: 'Ridge', hip: 'Hip', valley: 'Valley', eave: 'Eave', rake: 'Rake', wall_flashing: 'Wall flashing', step_flashing: 'Step flashing',
  curb_flashing: 'Curb flashing', transition: 'Transition', parapet: 'Parapet wall', unspecified: 'Unspecified',
};

export type EdgeVerification = 'unverified' | 'needs_verification' | 'verified';
export type EdgeSource = 'derived' | 'manual';

export type EdgeHistory = { at: string; userId: string; field: string; from: unknown; to: unknown; reason: string };

export type DerivedEdge = {
  id: string;
  type: GeometryEdgeType;
  /** True (sloped) length in feet. Null when the geometry is not reliable enough to state one. */
  lengthFt: number | null;
  /** Length measured in plan view, feet. */
  planLengthFt: number;
  /** End points in local metres (east, north). */
  a: Pt;
  b: Pt;
  facetIds: string[];
  source: EdgeSource;
  confidence: 'medium' | 'low';
  verification: EdgeVerification;
  /** Excluded edges are drawn greyed and not counted. */
  included: boolean;
  note: string;
  history: EdgeHistory[];
};

export type RoofFacet = {
  id: string;
  /** Matching Google Building Insights segment (area, pitch and direction come from it). */
  segmentId: string;
  polygon: Pt[];
  /** Plan-view (ground) area of the extracted polygon, m2. */
  planAreaM2: number;
  /** Google's roof-surface area for the matching segment, sq ft. */
  areaSqFt: number;
  pitchLabel: string;
  pitchDegrees: number;
  azimuthDegrees: number;
  flat: boolean;
  structureId: string;
  /** Plan area of the polygon compared with Google's ground area for the segment (1 = identical). */
  agreement: number | null;
  confidence: 'medium' | 'low';
};

export type RoofStructure = {
  id: string;
  kind: 'main' | 'additional';
  footprint: Pt[];
  footprintAreaSqFt: number;
  facetIds: string[];
  /** Additional structures only have a footprint: Google returned roof segments for the main building only. */
  roofAreaMeasured: boolean;
  note: string;
};

export type GeometryImagery = {
  /** Local-metre rectangle covered by the stored aerial image. */
  extent: { minX: number; maxX: number; minY: number; maxY: number };
  widthPx: number;
  heightPx: number;
  date: string | null;
  quality: string | null;
  fileId: string | null;
  retainedUntil: string | null;
};

export type RoofGeometry = {
  version: 1;
  method: 'dsm-mask-segment-assignment';
  status: 'ok' | 'partial' | 'unavailable';
  reason: string | null;
  frame: { epsg: number; cx: number; cy: number; latitude: number; longitude: number };
  pixelSizeM: number;
  structures: RoofStructure[];
  facets: RoofFacet[];
  edges: DerivedEdge[];
  imagery: GeometryImagery | null;
  warnings: string[];
  builtAt: string;
};
