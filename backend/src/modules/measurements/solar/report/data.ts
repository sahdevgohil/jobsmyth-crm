/** Report data assembled from a measurement, with consistency checks. Pure: no database access. */
import { EDGE_TYPE_LABEL, GEOMETRY_EDGE_TYPES, type GeometryEdgeType, type RoofGeometry } from '../geometry/types.js';
import type { MeasurementDocument } from '../../measurement.model.js';
import type { NormalizedRoof } from '../normalize.js';
import { round } from '../geo.js';
import { PITCHED_WASTE, FLAT_WASTE, wasteTable } from '../waste.js';

export type EdgeCategory = {
  type: GeometryEdgeType;
  label: string;
  /** Sum of the included edges that have a stated length (derived + verified). Null when nothing is known. */
  lengthFt: number | null;
  count: number;
  verifiedCount: number;
  needsVerification: number;
  status: 'verified' | 'derived' | 'mixed' | 'none_detected' | 'not_available';
  note: string;
};

const TYPED = new Set<GeometryEdgeType>(['ridge', 'hip', 'valley', 'eave', 'rake']);

export function edgeCategories(doc: MeasurementDocument): EdgeCategory[] {
  const g = doc.geometry as RoofGeometry | undefined;
  const hasGeometry = Boolean(g && g.facets.length > 0);
  const verifiedMap = (doc.verified ?? {}) as Record<string, boolean>;
  const sources = (doc.fieldSources ?? {}) as Record<string, string>;
  return GEOMETRY_EDGE_TYPES.map((type): EdgeCategory => {
    const mine = (g?.edges ?? []).filter((e) => e.type === type && e.included);
    const withLen = mine.filter((e) => e.lengthFt !== null);
    const done = withLen.filter((e) => e.verification === 'verified' || e.source === 'manual');
    const needs = mine.filter((e) => e.lengthFt === null).length;
    const typed = TYPED.has(type) ? (doc as unknown as Record<string, number | undefined>)[type] : undefined;
    const base = { type, label: EDGE_TYPE_LABEL[type], count: mine.length, verifiedCount: done.length, needsVerification: needs };
    if (withLen.length > 0) {
      const total = round(withLen.reduce((a, e) => a + (e.lengthFt as number), 0), 2);
      const all = done.length === withLen.length && needs === 0;
      return { ...base, lengthFt: total, status: all ? 'verified' : done.length > 0 ? 'mixed' : 'derived', note: all ? 'Field verified' : done.length > 0 ? 'Partly verified' : 'Automatically derived, not verified' };
    }
    if (typeof typed === 'number') return { ...base, count: base.count || 1, verifiedCount: verifiedMap[type] || sources[type] === 'manual' ? 1 : 0, lengthFt: typed, status: verifiedMap[type] ? 'verified' : 'mixed', note: verifiedMap[type] ? 'Field verified' : 'Entered by staff' };
    if (needs > 0) return { ...base, lengthFt: null, status: 'derived', note: `${needs} edge${needs === 1 ? '' : 's'} need verification (no length stated)` };
    return hasGeometry && g?.status !== 'unavailable'
      ? { ...base, lengthFt: null, status: 'none_detected', note: 'None detected' }
      : { ...base, lengthFt: null, status: 'not_available', note: 'Not available' };
  });
}

export type ReportCheck = { ok: boolean; problems: string[]; notes: string[] };

export type ReportInputs = {
  totalAreaSqFt: number;
  pitchedAreaSqFt: number;
  flatAreaSqFt: number;
  unspecifiedAreaSqFt: number;
  facetAreas: number[];
  structureRoofAreas: number[];
  edgeCategories: EdgeCategory[];
  edgesInGeometry: number;
  pitchedWasteSelected: number;
  flatWasteSelected: number;
};

/** Consistency checks run before a report is produced. Problems are printed on the notes page; they never silently change a value. */
export function checkReport(i: ReportInputs, roof: NormalizedRoof | undefined, manualTotal: boolean): ReportCheck {
  const problems: string[] = [];
  const notes: string[] = [];
  const tol = Math.max(1, i.totalAreaSqFt * 0.002);
  const parts = i.pitchedAreaSqFt + i.flatAreaSqFt + i.unspecifiedAreaSqFt;
  if (Math.abs(parts - i.totalAreaSqFt) > tol) problems.push(`Pitched + flat + unspecified area (${Math.round(parts)}) does not equal the total (${Math.round(i.totalAreaSqFt)} sq ft).`);
  const facetSum = i.facetAreas.reduce((a, b) => a + b, 0);
  if (i.facetAreas.length > 0) {
    if (manualTotal) notes.push('The total area was corrected manually, so it differs from the sum of Google segment areas.');
    else if (Math.abs(facetSum - i.totalAreaSqFt) > Math.max(tol, i.totalAreaSqFt * 0.01)) problems.push(`Facet areas add up to ${Math.round(facetSum)} sq ft but the total is ${Math.round(i.totalAreaSqFt)} sq ft (segments without an outline are still counted in the total).`);
  }
  const structSum = i.structureRoofAreas.reduce((a, b) => a + b, 0);
  if (i.structureRoofAreas.length > 0 && Math.abs(structSum - i.totalAreaSqFt) > tol) problems.push(`Structure roof areas add up to ${Math.round(structSum)} sq ft but the total is ${Math.round(i.totalAreaSqFt)} sq ft.`);
  for (const [name, base, list, sel] of [['pitched', i.pitchedAreaSqFt, PITCHED_WASTE, i.pitchedWasteSelected], ['flat', i.flatAreaSqFt, FLAT_WASTE, i.flatWasteSelected]] as const) {
    for (const r of wasteTable(base, list)) {
      if (Math.abs(r.finalAreaSqFt - (r.baseAreaSqFt + r.wasteAreaSqFt)) > 0.02) problems.push(`The ${name} waste table at ${r.percent}% does not add up.`);
    }
    void sel;
  }
  const listed = i.edgeCategories.reduce((a, c) => a + (c.lengthFt ?? 0), 0);
  if (i.edgesInGeometry > 0 && listed <= 0) problems.push('Edges exist but none has a length yet; every category will show as needing verification.');
  if (roof && roof.warnings.length > 0) for (const w of roof.warnings) notes.push(w);
  return { ok: problems.length === 0, problems, notes };
}
