/**
 * Branded PDF report for a COMPLETED form submission (inspection walkthrough).
 * The customer signature on the report is an acknowledgement of the inspection/walkthrough only;
 * it is NOT presented as a legally binding e-signature or third-party signing.
 */
import PDFDocument from 'pdfkit';
import mongoose from 'mongoose';
import { BRAND_LOGO_DATA_URI } from '../../assets/brand-logo.js';
import { recordAudit } from '../../services/audit.js';
import { buildStorageKey, getStorageAdapter } from '../../services/storage/local-storage.adapter.js';
import { AppError } from '../../utils/errors.js';
import { getCompany } from '../companies/company.service.js';
import { CustomerModel } from '../customers/customer.model.js';
import { PropertyModel } from '../customers/property.model.js';
import { FileModel } from '../files/file.model.js';
import { UserModel } from '../users/user.model.js';
import { CompanySettingsModel } from '../settings/company-settings.model.js';
import {
  CONDITION_RATING_LABELS,
  allFields,
  isFieldVisible,
  type Answers,
  type ConditionRating,
  type FormDefinition,
  type FormField,
} from './engine.js';
import { FormSubmissionModel, FormTemplateVersionModel } from './form.model.js';
import type { FormCtx } from './form.service.js';

const CHARCOAL = '#3c3c3c';
const RED = '#c32930';
const GREY = '#757575';
const LINE = '#e1e1e1';

const MAX_PHOTOS_PER_FIELD = 12;
const MAX_IMAGE_BYTES = 6_000_000;

async function readObject(key: string): Promise<Buffer | null> {
  const obj = await getStorageAdapter().getObject(key);
  if (!obj) return null;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of obj.body) {
    const b = chunk as Buffer;
    size += b.length;
    if (size > MAX_IMAGE_BYTES) return null;
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}

function formatAnswer(f: FormField, v: unknown): string {
  if (v === undefined || v === null || v === '') return '—';
  switch (f.type) {
    case 'yes_no': return v ? 'Yes' : 'No';
    case 'dropdown': return f.options?.find((o) => o.value === v)?.label ?? String(v);
    case 'multiselect': return (v as string[]).map((x) => f.options?.find((o) => o.value === x)?.label ?? x).join(', ') || '—';
    case 'measurement': { const m = v as { value: number; unit: string }; return `${m.value} ${m.unit}`; }
    case 'currency': return `$${((v as number) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    case 'date': return new Date(`${v as string}T12:00:00Z`).toLocaleDateString('en-US', { dateStyle: 'long', timeZone: 'UTC' });
    case 'datetime': return new Date(v as string).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Chicago' });
    case 'address': { const a = v as Record<string, string>; return [a.line1, a.city, [a.state, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', '); }
    case 'condition_rating': {
      const c = v as { rating: ConditionRating; notes?: string; measurement?: { value: number; unit: string } };
      return [CONDITION_RATING_LABELS[c.rating], c.measurement ? `${c.measurement.value} ${c.measurement.unit}` : '', c.notes ? `— ${c.notes}` : ''].filter(Boolean).join(' ');
    }
    case 'signature': return `Signed by ${(v as { signerName?: string }).signerName ?? 'customer'}`;
    case 'file': return `${(v as { fileIds: string[] }).fileIds.length} file(s) attached`;
    default: return String(v);
  }
}

export async function generateReport(ctx: FormCtx, submissionId: string, meta: { requestId?: string; ip?: string } = {}): Promise<{ fileId: string; filename: string; buffer: Buffer }> {
  const scope: Record<string, unknown> = { _id: submissionId, companyId: new mongoose.Types.ObjectId(ctx.companyId) };
  if (ctx.role !== 'admin') scope.$or = [{ createdBy: ctx.userId }, { assignedTo: ctx.userId }];
  const sub = mongoose.isValidObjectId(submissionId) ? await FormSubmissionModel.findOne(scope) : null;
  if (!sub) throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Form submission not found.' });
  if (sub.status !== 'completed') throw new AppError({ status: 409, code: 'NOT_COMPLETED', message: 'Only completed forms can produce a report.' });
  const version = await FormTemplateVersionModel.findOne({ companyId: sub.companyId, templateId: sub.templateId, version: sub.templateVersion });
  if (!version) throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Form version not found.' });
  const def = version.definition as FormDefinition;
  const answers = (sub.answers ?? {}) as Answers;

  const [company, settings, customer, property, inspector, files] = await Promise.all([
    getCompany(ctx.companyId),
    CompanySettingsModel.findOne().lean(),
    sub.customerId ? CustomerModel.findById(sub.customerId).lean() : null,
    sub.propertyId ? PropertyModel.findById(sub.propertyId).lean() : null,
    UserModel.findById(sub.completedBy ?? sub.createdBy).select({ firstName: 1, lastName: 1 }).lean(),
    FileModel.find({ formSubmissionId: sub._id }).sort({ capturedAt: 1, createdAt: 1 }).lean(),
  ]);
  const byField = new Map<string, typeof files>();
  for (const f of files) {
    const k = f.formFieldId ?? '';
    byField.set(k, [...(byField.get(k) ?? []), f]);
  }

  const doc = new PDFDocument({ size: 'LETTER', margin: 48, compress: process.env.NODE_ENV !== 'test', info: { Title: `${version.name} report`, Author: company?.name ?? 'Legacy Construction Group LLC' } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  const W = doc.page.width - 96;
  const ensure = (h: number): void => { if (doc.y + h > doc.page.height - 60) doc.addPage(); };

  // Header: official logo (aspect ratio preserved: width only), company details, red rule.
  const logo = Buffer.from(BRAND_LOGO_DATA_URI.split(',')[1] ?? '', 'base64');
  doc.image(logo, 48, 40, { width: 96 });
  doc.fillColor(CHARCOAL).font('Helvetica-Bold').fontSize(15).text(company?.branding?.displayName || company?.name || 'Legacy Construction Group LLC', 160, 46);
  doc.font('Helvetica').fontSize(9).fillColor(GREY);
  doc.text([settings?.phone, settings?.email, settings?.website].filter(Boolean).join('  ·  '), 160, 66);
  if (settings?.licenseText) doc.text(settings.licenseText, 160, 79);
  doc.moveTo(48, 128).lineTo(48 + W, 128).lineWidth(2).strokeColor(RED).stroke();
  doc.y = 140;
  doc.fillColor(CHARCOAL).font('Helvetica-Bold').fontSize(18).text(version.name, 48, doc.y);
  doc.font('Helvetica').fontSize(9).fillColor(GREY).text(`Form version ${sub.templateVersion} · Completed ${sub.completedAt?.toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Chicago' })}`);
  doc.moveDown(0.8);

  // Customer / property / inspector block
  const rows: Array<[string, string]> = [
    ['Customer', customer ? (customer.type === 'business' ? customer.companyName : `${customer.firstName} ${customer.lastName}`.trim()) : '—'],
    ['Property', property ? [property.address.line1, property.address.city, [property.address.state, property.address.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ') : '—'],
    ['Inspector', inspector ? `${inspector.firstName} ${inspector.lastName}` : '—'],
  ];
  for (const [k, v] of rows) {
    doc.font('Helvetica-Bold').fontSize(10).fillColor(CHARCOAL).text(`${k}: `, { continued: true }).font('Helvetica').text(v);
  }
  doc.moveDown(0.6);

  let signatureFile: { storageKey: string; name?: string; at?: string } | null = null;
  for (const section of def.sections) {
    const visible = section.fields.filter((f) => isFieldVisible(section, f, answers) && !f.sensitive);
    if (visible.length === 0) continue;
    ensure(60);
    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').fontSize(12).fillColor(RED).text(section.title);
    doc.moveTo(48, doc.y + 1).lineTo(48 + W, doc.y + 1).lineWidth(0.5).strokeColor(LINE).stroke();
    doc.moveDown(0.4);
    for (const f of visible) {
      if (f.type === 'signature') {
        const s = answers[f.id] as { fileId?: string; signerName?: string; signedAt?: string } | undefined;
        const file = s?.fileId ? files.find((x) => x._id.toString() === s.fileId) : undefined;
        if (file) signatureFile = { storageKey: file.storageKey, name: s?.signerName, at: s?.signedAt };
        continue;
      }
      if (f.type === 'photos') continue; // rendered below
      ensure(24);
      const y = doc.y;
      doc.font('Helvetica').fontSize(9).fillColor(GREY).text(f.label, 48, y, { width: 190 });
      doc.font('Helvetica').fontSize(10).fillColor(CHARCOAL).text(formatAnswer(f, answers[f.id]), 245, y, { width: W - 197 });
      doc.y = Math.max(doc.y, y + 14);
      // Photos attached to a rated item appear right under it.
      const attached = f.type === 'condition_rating' ? (byField.get(f.id) ?? []) : [];
      if (attached.length > 0) await drawPhotos(doc, attached.slice(0, MAX_PHOTOS_PER_FIELD), W);
    }
  }

  // Photo checklist sections (photos fields)
  for (const f of allFields(def).filter((x) => x.type === 'photos')) {
    const section = def.sections.find((s) => s.fields.includes(f));
    if (!section || !isFieldVisible(section, f, answers)) continue;
    const list = byField.get(f.id) ?? [];
    if (list.length === 0) continue;
    ensure(120);
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').fontSize(11).fillColor(CHARCOAL).text(`${f.label} (${list.length})`);
    doc.moveDown(0.3);
    await drawPhotos(doc, list.slice(0, MAX_PHOTOS_PER_FIELD), W);
  }

  // Customer acknowledgement
  ensure(150);
  doc.moveDown(1);
  doc.font('Helvetica-Bold').fontSize(12).fillColor(RED).text('Customer acknowledgement');
  doc.font('Helvetica').fontSize(9).fillColor(GREY).text('The customer signature below acknowledges that this inspection or walkthrough took place and that its findings were reviewed. It is not a contract or authorization to proceed.');
  doc.moveDown(0.5);
  const sigBuf = signatureFile ? await readObject(signatureFile.storageKey) : null;
  if (sigBuf) {
    try { doc.image(sigBuf, 48, doc.y, { fit: [200, 70] }); doc.y += 74; } catch { doc.font('Helvetica-Oblique').text('[signature image could not be rendered]'); }
    doc.font('Helvetica').fontSize(10).fillColor(CHARCOAL).text(`${signatureFile?.name ?? ''}${signatureFile?.at ? ` — ${new Date(signatureFile.at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Chicago' })}` : ''}`);
  } else {
    doc.font('Helvetica-Oblique').fontSize(10).fillColor(GREY).text('No customer signature was captured on this form.');
  }

  // Footer on every page
  const range = doc.bufferedPageRange();
  void range;
  doc.end();
  const buffer = await done;

  // Store the generated copy; the original completed submission is left untouched.
  const filename = `${version.key}-${sub._id.toString().slice(-6)}.pdf`;
  const storageKey = `${ctx.companyId}/${buildStorageKey(filename)}`;
  await getStorageAdapter().putObject({ key: storageKey, buffer, contentType: 'application/pdf' });
  const file = await FileModel.create({
    originalFilename: filename, storageKey, mimeType: 'application/pdf', sizeBytes: buffer.length, category: 'report',
    companyId: sub.companyId, customerId: sub.customerId, propertyId: sub.propertyId, inspectionId: sub.inspectionId, projectId: sub.projectId,
    caption: `${version.name} report`, visibility: 'internal', uploadedBy: new mongoose.Types.ObjectId(ctx.userId),
  });
  sub.reportFileId = file._id;
  await sub.save();
  await recordAudit({ actorType: 'user', actorId: ctx.userId, action: 'form_submission.report_generated', entityType: 'form_submission', entityId: sub._id.toString(), changes: { fileId: file._id.toString(), bytes: buffer.length }, requestId: meta.requestId, ip: meta.ip });
  return { fileId: file._id.toString(), filename, buffer };
}

async function drawPhotos(doc: PDFKit.PDFDocument, photos: Array<{ storageKey: string; mimeType: string; caption?: string | null; tag?: string | null }>, width: number): Promise<void> {
  const cellW = (width - 12) / 2;
  const cellH = 150;
  let col = 0;
  for (const p of photos) {
    if (!['image/jpeg', 'image/png'].includes(p.mimeType)) continue;
    const buf = await readObject(p.storageKey);
    if (!buf) continue;
    if (doc.y + cellH + 16 > doc.page.height - 60) { doc.addPage(); col = 0; }
    const x = 48 + col * (cellW + 12);
    const y = doc.y;
    try {
      doc.image(buf, x, y, { fit: [cellW, cellH], align: 'center', valign: 'center' });
    } catch {
      continue;
    }
    doc.font('Helvetica').fontSize(8).fillColor(GREY).text([p.tag, p.caption].filter(Boolean).join(' — '), x, y + cellH + 2, { width: cellW });
    col += 1;
    if (col === 2) { col = 0; doc.y = y + cellH + 18; } else { doc.y = y; }
  }
  if (col === 1) doc.y += cellH + 18;
}
