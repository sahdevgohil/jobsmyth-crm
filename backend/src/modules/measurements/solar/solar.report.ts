/**
 * Roof measurement report (PDF). Legacy Construction Group branding.
 * Structure: overview, roof diagram, lengths, areas, pitch and direction, structure summary, additional structures (only when present),
 * combined summary, waste, materials, optional photo appendix, notes and data checks.
 *
 * Honesty rules: provider values are never altered to match another report; aerial imagery is labelled as aerial imagery; automatically
 * derived values are marked until verified; missing values print "Not available" (never a fake zero); only verified inputs produce
 * length-based material quantities.
 */
import mongoose from 'mongoose';
import { recordAudit } from '../../../services/audit.js';
import { buildStorageKey, getStorageAdapter } from '../../../services/storage/local-storage.adapter.js';
import { AppError } from '../../../utils/errors.js';
import { getCompany } from '../../companies/company.service.js';
import { CustomerModel } from '../../customers/customer.model.js';
import { PropertyModel } from '../../customers/property.model.js';
import { FileModel } from '../../files/file.model.js';
import type { MeasurementDocument } from '../measurement.model.js';
import { CompanySettingsModel } from '../../settings/company-settings.model.js';
import { renderAerialOverlay, renderApproximateDiagram, renderDiagram, EDGE_COLOR } from './geometry/diagrams.js';
import { EDGE_TYPE_LABEL, GEOMETRY_EDGE_TYPES, type GeometryEdgeType, type RoofGeometry } from './geometry/types.js';
import { compassFromAzimuth, round } from './geo.js';
import { MATERIAL_DISCLAIMER } from './materials.js';
import type { NormalizedRoof } from './normalize.js';
import { C, CONTENT_W, PAGE, Pdf, type Col, type Row } from './report/pdf-kit.js';
import { checkReport, edgeCategories, type EdgeCategory } from './report/data.js';
import { addressLine, ftIn, num0, num1, reportFilename, sqft } from './report/format.js';
import { PHOTO_CATEGORIES, PHOTO_CATEGORY_LABEL, getAerial, getMaterials, listPhotos, summaryFor } from './solar.geometry.service.js';
import { loadMeasurement, type SolarCtx } from './solar.service.js';
import { FLAT_WASTE, PITCHED_WASTE, WASTE_PERCENTS, wasteTable, type WasteRow } from './waste.js';

export const REPORT_DISCLAIMER =
  'Measurements are derived from available aerial/property data and computational geometry. Field verification is recommended before material ordering, contractual pricing, or construction. Some roof features and concealed conditions cannot be determined from aerial imagery.';

const DAGGER = ' †';
const MAX_PHOTO_BYTES = 6_000_000;

export type ReportOptions = { wastePercent?: number; flatWastePercent?: number };

/** The download name for a measurement, from its property address and revision. */
export async function reportFilenameFor(m: MeasurementDocument): Promise<string> {
  const property = await PropertyModel.findById(m.propertyId);
  return reportFilename(property?.address, m.revision ?? 1, `RM-${m.createdAt.getUTCFullYear()}-${m._id.toString().slice(-6).toUpperCase()}-R${m.revision ?? 1}`);
}

function wasteBlock(pdf: Pdf, title: string, areaLabel: string, rows: WasteRow[], selected: number, recommended: number): void {
  const d = pdf.doc;
  const labelW = 130;
  const colW = (CONTENT_W - labelW) / rows.length;
  pdf.ensure(110);
  const y0 = pdf.y;
  const hit = rows.findIndex((r) => r.percent === selected);
  d.font('Helvetica').fontSize(8).fillColor(C.red);
  const rec = rows.findIndex((r) => r.percent === recommended);
  if (rec >= 0) d.text('Recommended', PAGE.margin + labelW + rec * colW, y0, { width: colW, align: 'center', lineBreak: false });
  const y = y0 + 12;
  d.rect(PAGE.margin, y, CONTENT_W, 22).fill(C.head);
  if (hit >= 0) d.rect(PAGE.margin + labelW + hit * colW, y, colW, 22 + 20 + 20).fill(C.soft);
  d.font('Helvetica-Bold').fontSize(9).fillColor(C.charcoal).text(title, PAGE.margin + 6, y + 6, { width: labelW - 8, lineBreak: false });
  rows.forEach((r, i) => d.font('Helvetica-Bold').fontSize(9).fillColor(C.charcoal).text(`${r.percent}%`, PAGE.margin + labelW + i * colW, y + 6, { width: colW, align: 'center', lineBreak: false }));
  d.font('Helvetica-Bold').fontSize(9).fillColor(C.text).text(areaLabel, PAGE.margin + 6, y + 28, { width: labelW - 8, lineBreak: false });
  d.font('Helvetica-Bold').fontSize(9).fillColor(C.text).text('Squares', PAGE.margin + 6, y + 48, { width: labelW - 8, lineBreak: false });
  rows.forEach((r, i) => {
    d.font('Helvetica').fontSize(9).fillColor(C.text).text(num0(r.finalAreaSqFt), PAGE.margin + labelW + i * colW, y + 28, { width: colW, align: 'center', lineBreak: false });
    d.text(num1(r.finalSquares), PAGE.margin + labelW + i * colW, y + 48, { width: colW, align: 'center', lineBreak: false });
  });
  pdf.y = y + 72;
}

function dataFromSegments(roof: NormalizedRoof | undefined, g: RoofGeometry | undefined): Array<{ label: string; segmentId: string; outlined: boolean; areaSqFt: number; pitchLabel: string; pitchDegrees: number; azimuthDegrees: number; flat: boolean }> {
  if (!roof) return [];
  return roof.segments.map((s) => {
    const f = g?.facets.find((x) => x.segmentId === s.id);
    return { label: f ? f.id : s.id, segmentId: s.id, outlined: Boolean(f), areaSqFt: s.areaSqFt, pitchLabel: s.pitchLabel, pitchDegrees: s.pitchDegrees, azimuthDegrees: s.azimuthDegrees, flat: s.pitchDegrees < 5 };
  });
}

export async function generateSolarReport(ctx: SolarCtx, measurementId: string, opts: ReportOptions | number = {}): Promise<{ fileId: string; filename: string; buffer: Buffer; reportNumber: string; pages: number; checks: { ok: boolean; problems: string[] } }> {
  const o: ReportOptions = typeof opts === 'number' ? { wastePercent: opts } : opts;
  const m = await loadMeasurement(ctx, measurementId);
  const roof = m.automated as (NormalizedRoof & { requestedAt?: string }) | undefined;
  if (!roof && !m.totalArea) throw new AppError({ status: 422, code: 'NO_MEASUREMENT_DATA', message: 'This measurement has no data to report on.' });
  const waste = o.wastePercent ?? m.wastePercent ?? 14;
  const flatWaste = o.flatWastePercent ?? m.flatWastePercent ?? 15;
  for (const [name, v] of [['waste', waste], ['flat waste', flatWaste]] as const) {
    if (!(WASTE_PERCENTS as readonly number[]).includes(v)) throw new AppError({ status: 422, code: 'VALIDATION_ERROR', message: `The ${name} must be one of ${WASTE_PERCENTS.join(', ')}%.` });
  }
  const [customer, property, company, settings, photos, mats] = await Promise.all([
    CustomerModel.findById(m.customerId),
    PropertyModel.findById(m.propertyId),
    getCompany(ctx.companyId).catch(() => null),
    CompanySettingsModel.findOne(),
    listPhotos(ctx, measurementId),
    getMaterials(ctx, measurementId, waste),
  ]);
  const g = m.geometry as RoofGeometry | undefined;
  const hasGeometry = Boolean(g && g.facets.length > 0 && g.structures.length > 0);
  const sum = summaryFor(m);
  const cats = edgeCategories(m);
  const cat = (t: GeometryEdgeType): EdgeCategory => cats.find((c) => c.type === t) as EdgeCategory;
  const reportNumber = `RM-${m.createdAt.getUTCFullYear()}-${m._id.toString().slice(-6).toUpperCase()}-R${m.revision ?? 1}`;
  const isDemo = Boolean(m.isDemo);
  const addr = addressLine(property?.address) || 'Address not available';
  const customerName = customer ? (customer.type === 'business' ? customer.companyName : `${customer.firstName} ${customer.lastName}`.trim()) || 'Not available' : 'Not available';
  const companyName = company?.branding?.displayName || company?.name || 'Legacy Construction Group LLC';
  const date = new Date().toLocaleDateString('en-US', { dateStyle: 'long', timeZone: 'America/Chicago' });
  const filename = reportFilename(property?.address, m.revision ?? 1, reportNumber);
  const sources = (m.fieldSources ?? {}) as Record<string, string>;
  const manualTotal = sources.totalArea === 'manual';
  const segs = dataFromSegments(roof, g);
  const unspecified = 0; // every segment kept by the importer has a pitch; segments without one are dropped with a warning
  const mainStruct = sum.structures[0];
  const extraStructs = sum.structures.slice(1);
  const checks = checkReport(
    { totalAreaSqFt: sum.totalAreaSqFt, pitchedAreaSqFt: sum.pitchedAreaSqFt, flatAreaSqFt: sum.flatAreaSqFt, unspecifiedAreaSqFt: unspecified, facetAreas: segs.map((s) => s.areaSqFt), structureRoofAreas: sum.structures.filter((s) => s.roofAreaMeasured).map((s) => s.roofAreaSqFt ?? 0), edgeCategories: cats, edgesInGeometry: g?.edges.length ?? 0, pitchedWasteSelected: waste, flatWasteSelected: flatWaste },
    roof, manualTotal,
  );

  const pdf = new Pdf(
    { companyName, website: settings?.website ?? '', address: addr, reportNumber, revision: m.revision ?? 1, date, demo: isDemo, footerNote: isDemo ? 'Demonstration data' : 'Includes data from Google Maps. Source: Includes solar data from Google.' },
    `Roof Measurement Report ${filename.replace(/\.pdf$/, '')}`, companyName, process.env.NODE_ENV !== 'test',
  );
  const d = pdf.doc;
  const dia = (kind: 'outline' | 'facets' | 'area' | 'pitch' | 'edges', w: number, h: number, showExtras = false): string => (hasGeometry ? renderDiagram(g as RoofGeometry, kind, { width: w, height: h, bare: true, showExtras }) : renderApproximateDiagram((roof?.segments ?? []).map((s) => ({ id: s.id, pitchLabel: s.pitchLabel, areaSqFt: s.areaSqFt, boundingBox: s.boundingBox })), w, h));
  const placeDiagram = (kind: 'outline' | 'facets' | 'area' | 'pitch' | 'edges', h: number, showExtras = false): void => {
    pdf.ensure(h + 10);
    const y = pdf.y;
    d.rect(PAGE.margin, y, CONTENT_W, h).lineWidth(0.5).strokeColor(C.line).stroke();
    pdf.svg(dia(kind, CONTENT_W, h, showExtras), PAGE.margin, y, CONTENT_W, h);
    pdf.y = y + h + 6;
    if (!hasGeometry) pdf.para('APPROXIMATE: a roof outline could not be extracted, so this is not a true roof diagram (dashed boxes are Google segment bounding boxes). See the notes page.', { color: C.red, size: 8.5, italic: true });
  };
  const mark = (c: EdgeCategory): string => (c.lengthFt === null ? c.note : `${ftIn(c.lengthFt)}${c.status === 'verified' ? '' : DAGGER}`);

  // ---------------------------------------------------------------- 1 overview
  pdf.page('Roof Measurement Report', addr);
  pdf.kv([['Customer', customerName], ['Report number', reportNumber], ['Report date', date], ['Revision', String(m.revision ?? 1)], ['Source', isDemo ? 'Demonstration fixture' : m.source === 'google_solar' ? 'Google Solar API' : 'Manual entry']], 2, { labelW: 100 });
  const boxY = pdf.y;
  const boxH = 360;
  let aerial = false;
  if (g?.imagery?.fileId) {
    try {
      const a = await getAerial(ctx, measurementId);
      const sc = Math.min(CONTENT_W / a.imagery.widthPx, boxH / a.imagery.heightPx);
      const dw = a.imagery.widthPx * sc;
      const dh = a.imagery.heightPx * sc;
      const x0 = PAGE.margin + (CONTENT_W - dw) / 2;
      d.image(a.buffer, x0, boxY, { width: dw, height: dh });
      const overlay = renderAerialOverlay(g);
      if (overlay) pdf.svg(overlay, x0, boxY, dw, dh);
      d.rect(x0, boxY, dw, dh).lineWidth(0.5).strokeColor(C.line).stroke();
      // North indicator (aerial imagery from Google is north-up).
      const nx = x0 + dw - 22;
      d.circle(nx, boxY + 24, 14).fillOpacity(0.85).fill('#ffffff').fillOpacity(1);
      d.moveTo(nx, boxY + 13).lineTo(nx - 5, boxY + 28).lineTo(nx, boxY + 25).lineTo(nx + 5, boxY + 28).closePath().fill(C.charcoal);
      d.font('Helvetica-Bold').fontSize(7).fillColor(C.charcoal).text('N', nx - 3, boxY + 28, { width: 6, lineBreak: false });
      pdf.y = boxY + dh + 6;
      aerial = true;
      d.font('Helvetica').fontSize(8).fillColor(C.grey).text(`Aerial imagery © Google, captured ${g.imagery.date ?? 'date not provided'}, quality ${g.imagery.quality ?? 'not provided'}. Source: Includes solar data from Google. Red outline: detected building footprint. White lines: roof facets. Red dot: property location. This is aerial imagery, not an inspection photograph.`, PAGE.margin, pdf.y, { width: CONTENT_W });
      d.moveDown(0.5);
    } catch {
      aerial = false;
    }
  }
  if (!aerial) {
    d.rect(PAGE.margin, boxY, CONTENT_W, 170).fill('#f4f4f4');
    d.font('Helvetica-Bold').fontSize(11).fillColor(C.charcoal).text('Aerial imagery not available', PAGE.margin, boxY + 62, { width: CONTENT_W, align: 'center' });
    d.font('Helvetica').fontSize(9).fillColor(C.grey).text(g?.reason ?? (g?.imagery && !g.imagery.fileId ? 'The aerial image was not retained (retention is set to 0 days) or has expired. Use Refresh imagery to fetch it again.' : 'Imagery was not requested for this measurement.'), PAGE.margin + 30, boxY + 82, { width: CONTENT_W - 60, align: 'center' });
    pdf.y = boxY + 180;
  }
  pdf.kv([
    ['Total roof area', `${sqft(sum.totalAreaSqFt)}${sources.totalArea === 'manual' ? ' (manually entered)' : ''}`], ['Roofing squares', `${num1(sum.squares)} SQ`],
    ['Roof facets', String(sum.facetCount)], ['Predominant pitch', sum.predominantPitch || 'Not available'],
    ['Pitched area', sqft(sum.pitchedAreaSqFt)], ['Flat area', sqft(sum.flatAreaSqFt)],
    ['Imagery date', roof?.imagery.date ?? 'Not available'], ['Imagery quality', roof?.imagery.quality ?? 'Not available'],
  ], 2, { labelW: 110 });

  // ---------------------------------------------------------------- 2 roof diagram
  pdf.page('Roof Diagram', `${addr}  ·  facet IDs with pitch`);
  placeDiagram('facets', Math.min(560, pdf.remaining() - 40), false);
  pdf.para('F1, F2, ... are roof facets (sections of roof at one pitch and direction). Other structures found nearby are outlined (dashed) on the additional-structures page; they have no roof measurement.', { size: 8.5, color: C.grey });

  // ---------------------------------------------------------------- 3 lengths
  pdf.page('Length Measurement Report', `${addr}  ·  roof edges by type`);
  const order: GeometryEdgeType[] = ['eave', 'valley', 'hip', 'ridge', 'rake', 'wall_flashing', 'step_flashing', 'curb_flashing', 'transition', 'parapet', 'unspecified'];
  const ly = pdf.y;
  order.forEach((t, i) => {
    const c = cat(t);
    const col = i % 3;
    const row = Math.floor(i / 3);
    pdf.swatch(PAGE.margin + col * (CONTENT_W / 3), ly + row * 15, EDGE_COLOR[t], `${c.label}: ${mark(c)}`, { dashed: c.status !== 'verified' && c.lengthFt !== null, width: CONTENT_W / 3 - 28 });
  });
  pdf.y = ly + Math.ceil(order.length / 3) * 15 + 6;
  placeDiagram('edges', 270);
  pdf.para('Diagram labels are whole feet; overlapping labels are left out but every edge is in the table. Dashed = derived, not field verified; solid = verified or entered by staff.', { size: 8, color: C.grey, italic: true });
  const edgeCols: Col[] = [{ label: 'Edge type', width: 130 }, { label: 'Total length', width: 110, align: 'right' }, { label: 'Edges', width: 50, align: 'right' }, { label: 'Verified', width: 60, align: 'right' }, { label: 'Status', width: CONTENT_W - 350 }];
  const edgeRows = (types: GeometryEdgeType[]): Row[] => types.map((t) => { const c = cat(t); return { cells: [c.label, c.lengthFt === null ? '—' : ftIn(c.lengthFt), String(c.count), String(c.verifiedCount), c.note] }; });
  pdf.table(edgeCols, edgeRows(order));
  pdf.para(`${DAGGER.trim()} includes automatically derived edges that have not been verified. Edges flagged as needing verification have no stated length and are not in any total.`, { size: 8, color: C.grey });

  // ---------------------------------------------------------------- 4 area
  pdf.page('Area Measurement Report', `${addr}  ·  roof surface area`);
  const predomArea = sum.pitchBreakdown[0]?.areaSqFt ?? null;
  pdf.kv([
    ['Total roof area', sqft(sum.totalAreaSqFt)], ['Predominant pitch', sum.predominantPitch || 'Not available'],
    ['Pitched roof area', sqft(sum.pitchedAreaSqFt)], ['Predominant pitch area', sqft(predomArea)],
    ['Flat roof area', sqft(sum.flatAreaSqFt)], ['Unspecified pitch area', sqft(unspecified)],
    ['Two story area', 'Not available'], ['Two layer area', 'Not available'],
  ], 2, { labelW: 118 });
  placeDiagram('area', 300);
  const facetCols: Col[] = [{ label: 'Facet', width: 120 }, { label: 'Area (sqft)', width: 110, align: 'right' }, { label: 'Squares', width: 90, align: 'right' }, { label: 'Pitch', width: 90, align: 'right' }, { label: 'Type', width: CONTENT_W - 410 }];
  pdf.table(facetCols, [
    ...segs.map((s): Row => ({ cells: [s.outlined ? s.label : `${s.label} (no outline)`, num0(s.areaSqFt), num1(s.areaSqFt / 100), s.flat ? `${s.pitchLabel} (flat)` : s.pitchLabel, s.flat ? 'Flat' : 'Pitched'] })),
    { cells: ['Total', num0(sum.totalAreaSqFt), num1(sum.squares), '', ''], kind: 'total' },
  ]);
  pdf.para('Areas are roof surface areas from the Google Solar segments (square feet, rounded for display); totals are the sum of the exact values.', { size: 8, color: C.grey, italic: true });

  // ---------------------------------------------------------------- 5 pitch and direction
  pdf.page('Pitch and Direction Report', `${addr}  ·  pitch (rise per 12 of run) and downhill direction`);
  placeDiagram('pitch', 300);
  const dirCols: Col[] = [{ label: 'Facet', width: 120 }, { label: 'Pitch', width: 90, align: 'right' }, { label: 'Angle', width: 90, align: 'right' }, { label: 'Direction', width: 110 }, { label: 'Azimuth', width: CONTENT_W - 410, align: 'right' }];
  pdf.table(dirCols, segs.map((s): Row => ({ cells: [s.outlined ? s.label : `${s.label} (no outline)`, s.flat ? `${s.pitchLabel} (flat)` : s.pitchLabel, `${round(s.pitchDegrees, 1)}°`, s.flat ? 'Flat (no slope direction)' : `${compassFromAzimuth(s.azimuthDegrees)}-facing`, s.flat ? '—' : `${Math.round(s.azimuthDegrees)}°`] })));
  pdf.para(`Predominant pitch: ${sum.predominantPitch || 'Not available'}. Direction is the compass direction each facet slopes toward (0° = north, 90° = east); arrows in the diagram point downhill. Pitch is 12 × tan(angle), rounded to the nearest whole number.`, { size: 8.5, color: C.grey });

  // ---------------------------------------------------------------- 6 structure 1
  pdf.page('Structure #1 Summary', `${addr}  ·  ${mainStruct?.label ?? 'Main building'}`);
  const topY = pdf.y;
  const dw = 270;
  const dh = 320;
  d.rect(PAGE.margin, topY, dw, dh).lineWidth(0.5).strokeColor(C.line).stroke();
  pdf.svg(dia('facets', dw, dh), PAGE.margin, topY, dw, dh);
  const rx = PAGE.margin + dw + 16;
  const rw = CONTENT_W - dw - 16;
  const measures: Array<[string, string]> = [
    ['Total roof area', sqft(mainStruct?.roofAreaSqFt ?? sum.totalAreaSqFt)], ['Total pitched area', sqft(mainStruct?.pitchedAreaSqFt ?? sum.pitchedAreaSqFt)], ['Total flat area', sqft(mainStruct?.flatAreaSqFt ?? sum.flatAreaSqFt)],
    ['Total roof facets', String(mainStruct?.facetCount ?? sum.facetCount)], ['Predominant pitch', sum.predominantPitch || 'Not available'],
    ...(['eave', 'valley', 'hip', 'ridge', 'rake', 'wall_flashing', 'step_flashing', 'curb_flashing', 'transition', 'parapet', 'unspecified'] as GeometryEdgeType[]).map((t): [string, string] => [`Total ${EDGE_TYPE_LABEL[t].toLowerCase()}`, cat(t).lengthFt === null && cat(t).needsVerification > 0 ? `${cat(t).needsVerification} need verification` : mark(cat(t))]),
    ['Hips + ridges', cat('hip').lengthFt !== null && cat('ridge').lengthFt !== null ? `${ftIn((cat('hip').lengthFt as number) + (cat('ridge').lengthFt as number))}${cat('hip').status === 'verified' && cat('ridge').status === 'verified' ? '' : DAGGER}` : 'Not available'],
    ['Eaves + rakes', cat('eave').lengthFt !== null && cat('rake').lengthFt !== null ? `${ftIn((cat('eave').lengthFt as number) + (cat('rake').lengthFt as number))}${cat('eave').status === 'verified' && cat('rake').status === 'verified' ? '' : DAGGER}` : 'Not available'],
  ];
  d.rect(rx, topY, rw, 19).fill(C.head);
  d.font('Helvetica-Bold').fontSize(9).fillColor(C.charcoal).text('Measurements', rx + 6, topY + 5, { lineBreak: false });
  measures.forEach(([k, v], i) => {
    const yy = topY + 24 + i * 17;
    d.font('Helvetica').fontSize(8.6).fillColor(C.text).text(k, rx + 6, yy, { width: rw * 0.55, lineBreak: false });
    d.font('Helvetica-Bold').fontSize(8.6).fillColor(C.charcoal).text(v, rx + rw * 0.52, yy, { width: rw * 0.48 - 4, align: 'right', lineBreak: false, ellipsis: true });
  });
  pdf.y = topY + Math.max(dh, 24 + measures.length * 17) + 10;
  pdf.table([{ label: 'Pitch', width: 120 }, { label: 'Facets', width: 80, align: 'right' }, { label: 'Area (sqft)', width: 130, align: 'right' }, { label: 'Squares', width: 90, align: 'right' }, { label: 'Share of roof', width: CONTENT_W - 420, align: 'right' }], sum.pitchBreakdown.map((p): Row => ({ cells: [p.flat ? `${p.pitch} (flat)` : p.pitch, String(p.segmentCount), num0(p.areaSqFt), num1(p.areaSqFt / 100), `${p.percent}%`] })));
  wasteBlock(pdf, 'Pitched waste %', 'Pitched area (sqft)', mats.wasteTables.pitched, mats.wastePercent, mats.recommended.pitched);
  pdf.para(`${DAGGER.trim()} includes automatically derived edges that are not yet verified.`, { size: 8, color: C.grey });

  // ---------------------------------------------------------------- 7 additional structures
  if (extraStructs.length > 0) {
    pdf.page('Additional Structure Summaries', `${addr}  ·  other structures near the property`);
    const tw = 210;
    const th = 130;
    extraStructs.forEach((s) => {
      pdf.ensure(th + 12);
      const x = PAGE.margin;
      const y = pdf.y;
      const sg = g?.structures.find((x2) => x2.id === s.id);
      d.rect(x, y, tw, th).lineWidth(0.5).strokeColor(C.line).stroke();
      if (sg && g) {
        const solo: RoofGeometry = { ...g, facets: [], edges: [], structures: [{ ...sg, kind: 'main' }] };
        pdf.svg(renderDiagram(solo, 'outline', { width: tw, height: th, bare: true }), x, y, tw, th);
      }
      d.font('Helvetica-Bold').fontSize(10.5).fillColor(C.charcoal).text(`${s.label}: outline only`, x + tw + 16, y + 10, { width: CONTENT_W - tw - 16, lineBreak: false });
      d.font('Helvetica').fontSize(9).fillColor(C.text).text(`Footprint area: ${sqft(s.footprintAreaSqFt)}${s.roofAreaMeasured ? '' : '\nRoof surface area: not measured. The footprint is shown for reference only and is not part of any roof total.'}`, x + tw + 16, y + 28, { width: CONTENT_W - tw - 16 });
      pdf.y = y + th + 12;
    });
    pdf.para('Google returns roof segments for one building per request. These outlines come from the building mask and show where other structures stand; to measure one, run a measurement for its own address.', { size: 8.5, color: C.grey });
  }

  // ---------------------------------------------------------------- 8 combined summary
  pdf.page('Combined Report Summary', addr);
  pdf.kv([['Total roof area', sqft(sum.totalAreaSqFt)], ['Predominant pitch', sum.predominantPitch || 'Not available'], ['Total pitched area', sqft(sum.pitchedAreaSqFt)], ['Total roof facets', String(sum.facetCount)], ['Total flat area', sqft(sum.flatAreaSqFt)], ['Roofing squares', `${num1(sum.squares)} SQ`]], 2, { labelW: 118 });
  pdf.h2('Structures');
  pdf.table([{ label: 'Structure', width: 150 }, { label: 'Roof area (sqft)', width: 110, align: 'right' }, { label: 'Pitched', width: 80, align: 'right' }, { label: 'Flat', width: 70, align: 'right' }, { label: 'Facets', width: CONTENT_W - 410, align: 'right' }],
    [...sum.structures.map((s): Row => ({ cells: [s.label, s.roofAreaSqFt === null ? 'Not measured' : num0(s.roofAreaSqFt), s.pitchedAreaSqFt === null ? '—' : num0(s.pitchedAreaSqFt), s.flatAreaSqFt === null ? '—' : num0(s.flatAreaSqFt), s.facetCount === null ? '—' : String(s.facetCount)] })), { cells: ['Total', num0(sum.totalAreaSqFt), num0(sum.pitchedAreaSqFt), num0(sum.flatAreaSqFt), String(sum.facetCount)], kind: 'total' }]);
  pdf.h2('Edges');
  pdf.table([{ label: 'Edge type', width: 150 }, { label: 'Total length', width: 130, align: 'right' }, { label: 'Status', width: CONTENT_W - 280 }], order.map((t): Row => { const c = cat(t); return { cells: [c.label, c.lengthFt === null ? '—' : ftIn(c.lengthFt), c.note] }; }));
  pdf.h2('Pitch');
  pdf.table([{ label: 'Pitch', width: 150 }, { label: 'Area (sqft)', width: 130, align: 'right' }, { label: 'Squares', width: CONTENT_W - 280, align: 'right' }], sum.pitchBreakdown.map((p): Row => ({ cells: [p.flat ? `${p.pitch} (flat)` : p.pitch, num0(p.areaSqFt), num1(p.areaSqFt / 100)] })));

  // ---------------------------------------------------------------- 9 waste
  pdf.page('Waste Calculations', `${addr}  ·  pitched and flat areas are calculated separately`);
  wasteBlock(pdf, 'Pitched waste %', 'Pitched area (sqft)', mats.wasteTables.pitched, mats.wastePercent, mats.recommended.pitched);
  pdf.space(14);
  if (sum.flatAreaSqFt > 0) wasteBlock(pdf, 'Flat waste %', 'Flat area (sqft)', mats.wasteTables.flat, mats.flatWastePercent, mats.recommended.flat);
  else pdf.para('Flat roof area: 0 sqft. This roof has no flat sections, so no flat-roof waste calculation applies.', { size: 9.5, color: C.charcoal });
  pdf.space(10);
  pdf.para(`Selected: ${mats.wastePercent}% for pitched roof${sum.flatAreaSqFt > 0 ? ` and ${mats.flatWastePercent}% for flat roof` : ''} (highlighted). "Recommended" marks the company's configured default (${mats.recommended.pitched}% pitched, ${mats.recommended.flat}% flat); it is not a supplier specification.`, { size: 9 });
  pdf.para('These figures are for ordering materials. Waste is applied once to the base area. The customer price catalog already includes waste in its shingle rates, so estimates use the base squares and must not add this waste again.', { size: 9 });
  pdf.para('Several factors affect the right waste percentage, including roof complexity, valley style, product and installation method. You will also need to work out post-waste quantities of other materials (hip and ridge caps, starter and so on).', { size: 8.5, color: C.grey });

  // ---------------------------------------------------------------- 10 materials
  pdf.page('Material Calculations', `${addr}  ·  ${mats.wastePercent === 14 ? '' : 'selected waste '}${mats.productsConfigured ? 'company product catalog' : 'no company products configured'}`);
  const cols = mats.wasteColumns;
  const mCols: Col[] = [{ label: 'Product', width: CONTENT_W - 62 - cols.length * 62 }, { label: 'Unit', width: 62 }, ...cols.map((w): Col => ({ label: `${w}% waste`, width: 62, align: 'right' }))];
  const rows: Row[] = [];
  for (const f of mats.families) {
    const unit = f.unit === 'sqft' ? 'sqft' : f.unit === 'ft' ? 'ft' : '';
    if (f.status === 'no_product') { rows.push({ cells: [`${f.label} (${f.basisLabel}): no product configured`], kind: 'group', span: true }); continue; }
    if (f.status === 'missing' || f.status === 'unverified') {
      rows.push({ cells: [`${f.label} (${f.basisLabel}): not calculated, ${f.blocking.join('; ')}`], kind: 'group', span: true });
    } else {
      rows.push({ cells: [`${f.label} (${f.basisLabel})`, '', ...cols.map((w) => (f.basis[w] === null || f.basis[w] === undefined ? '—' : `${num0(f.basis[w] as number)} ${unit}`.trim()))], kind: 'group' });
    }
    for (const n of f.notes) rows.push({ cells: [`Note: ${n}`], span: true });
    for (const p of f.products) {
      const label = `${p.brand ? `${p.brand} - ` : ''}${p.name}${p.generic ? '' : p.specConfirmed ? '' : ' *'}`;
      rows.push({ cells: [label, p.packageUnit, ...cols.map((w) => (p.packages[w] === null || p.packages[w] === undefined ? '—' : String(p.packages[w])))] });
    }
  }
  pdf.table(mCols, rows, { fontSize: 8.4 });
  pdf.para(`Quantities are rounded up to whole packages. Shingle and underlayment use the pitched area (${sqft(sum.pitchedAreaSqFt)}, from Google Solar) with waste. Edge-based items use only verified or staff-entered lengths; a derived length that has not been verified is never used for ordering. Flat roof area is not included in these quantities.`, { size: 8.5, color: C.grey });
  pdf.para(`* Coverage per package is the value entered by the company and has not been confirmed against a supplier specification. "Generic estimate" rows use placeholder coverage because no product is configured for that family: set real products in the integration settings.`, { size: 8.5, color: C.grey });
  pdf.para(MATERIAL_DISCLAIMER, { size: 8.5, color: C.charcoal, italic: true });

  // ---------------------------------------------------------------- photo appendix (only when photos exist)
  if (photos.length > 0) {
    pdf.page('Field Photographs', `${addr}  ·  photographs taken or uploaded by staff`);
    const cw = (CONTENT_W - 14) / 2;
    for (const cat2 of PHOTO_CATEGORIES) {
      const list = photos.filter((p) => p.category === cat2);
      if (list.length === 0) continue;
      pdf.ensure(40);
      pdf.h2(`${PHOTO_CATEGORY_LABEL[cat2]} (${list.length})`);
      let col = 0;
      let rowTop = pdf.y;
      for (const p of list.slice(0, 8)) {
        const f = await FileModel.findById(p.id);
        const obj = f ? await getStorageAdapter().getObject(f.storageKey) : null;
        if (!obj || !['image/jpeg', 'image/png'].includes(p.mimeType)) continue;
        const parts: Buffer[] = [];
        let size = 0;
        for await (const part of obj.body) { size += (part as Buffer).length; if (size > MAX_PHOTO_BYTES) break; parts.push(part as Buffer); }
        if (size > MAX_PHOTO_BYTES) continue;
        if (col === 0 && rowTop + 190 > PAGE.bottom) { pdf.page('Field Photographs (continued)'); rowTop = pdf.y; }
        const x = PAGE.margin + col * (cw + 14);
        try { d.image(Buffer.concat(parts), x, rowTop, { fit: [cw, 140], align: 'center', valign: 'center' }); } catch { continue; }
        d.font('Helvetica').fontSize(8).fillColor(C.grey).text([p.notes, p.relatedItem, p.verified ? 'verified' : 'not verified', p.capturedAt ? new Date(p.capturedAt).toLocaleDateString('en-US') : 'date not recorded'].filter(Boolean).join(' · '), x, rowTop + 144, { width: cw, height: 24 });
        col += 1;
        if (col === 2) { col = 0; rowTop += 176; }
      }
      pdf.y = (col === 1 ? rowTop + 176 : rowTop) + 4;
    }
  }

  // ---------------------------------------------------------------- notes
  pdf.page('Notes, Sources and Data Checks', addr);
  const notes: string[] = [];
  notes.push(`Data source: ${isDemo ? 'demonstration fixture (not Google).' : m.source === 'google_solar' ? 'Google Solar API. Building Insights provides area, pitch and direction; Data Layers provide the aerial image, elevation and building mask used for outlines and edges.' : 'manual entry.'}`);
  if (roof?.imagery.date) notes.push(`Imagery date ${roof.imagery.date}, processed ${roof.imagery.processedDate ?? 'n/a'}, quality ${roof.imagery.quality ?? 'n/a'}.`);
  notes.push(hasGeometry ? `Roof outline: derived by Legacy from the building mask and elevation model (${g?.status === 'ok' ? 'complete' : 'partial'}). Outlines and edge lengths are estimates; area, pitch and direction are Google's values, not measured from the outline.` : `Roof outline: NOT available (${g?.reason ?? 'imagery was not requested'}). Diagrams are approximate.`);
  notes.push('Source labels: "Google Solar" = value supplied by the provider. "Calculated" = derived by arithmetic from provider values (squares, pitch). "Automatically derived" = produced by software from elevation data, not checked on site. "Manually entered" = typed in by staff. "Field verified" = confirmed by a person.');
  notes.push('Other measurement providers can report different totals and facet counts for the same address: they use different imagery dates, segmentation and rounding. This report shows Google\'s values as received and does not adjust them to match any other report.');
  const cor = ((m.corrections ?? []) as Array<{ reason: string }>).filter((c) => !c.reason.startsWith('Verified:')).length;
  if (cor > 0) notes.push(`${cor} manual correction(s) were recorded; the original provider values are preserved in the CRM.`);
  if (photos.length === 0) notes.push('No field photographs were attached to this measurement.');
  for (const n of checks.notes) notes.push(n);
  if (m.notes) notes.push(`Staff notes: ${m.notes}`);
  for (const n of notes) pdf.para(`•  ${n}`, { size: 9 });
  pdf.h2('Data checks');
  if (checks.ok) pdf.para('All consistency checks passed: pitched + flat + unspecified area equals the total, structure totals reconcile with the overall total, and waste tables add up.', { size: 9 });
  else for (const p of checks.problems) pdf.para(`•  ${p}`, { size: 9, color: C.red });
  pdf.space(6);
  pdf.para(REPORT_DISCLAIMER, { size: 9, color: C.charcoal, italic: true });

  const { buffer, pages } = await pdf.finish();
  const storageKey = `${ctx.companyId}/${buildStorageKey(filename)}`;
  await getStorageAdapter().putObject({ key: storageKey, buffer, contentType: 'application/pdf' });
  const file = await FileModel.create({
    originalFilename: filename, storageKey, mimeType: 'application/pdf', sizeBytes: buffer.length, category: 'report', companyId: new mongoose.Types.ObjectId(ctx.companyId), customerId: m.customerId, propertyId: m.propertyId,
    inspectionId: m.inspectionId, measurementId: m._id, caption: `Roof measurement report ${reportNumber}`, visibility: 'internal', uploadedBy: new mongoose.Types.ObjectId(ctx.userId),
  });
  m.reportFileId = file._id;
  await m.save();
  await recordAudit({ actorType: 'user', actorId: ctx.userId, action: 'measurement.report_generated', entityType: 'measurement', entityId: m._id.toString(), changes: { fileId: file._id.toString(), reportNumber, filename, bytes: buffer.length, pages, waste, flatWaste, checksOk: checks.ok }, requestId: ctx.requestId, ip: ctx.ip });
  return { fileId: file._id.toString(), filename, buffer, reportNumber, pages, checks: { ok: checks.ok, problems: checks.problems } };
}

export { GEOMETRY_EDGE_TYPES, PITCHED_WASTE, FLAT_WASTE, wasteTable };
