/**
 * Consistency checks for a demo dataset (pure, no DB). Used by the seed script and unit tests.
 */
import type { DemoOp } from './demo-data.js';

export function verifyDemoOps(ops: DemoOp[]): string[] {
  const problems: string[] = [];
  const idsByModel = new Map<string, Set<string>>();
  const seen = new Set<string>();
  for (const { model, doc } of ops) {
    const name = model.modelName;
    const key = `${name}:${doc._id.toHexString()}`;
    if (seen.has(key)) problems.push(`Duplicate id for ${key}`);
    seen.add(key);
    if (!idsByModel.has(name)) idsByModel.set(name, new Set());
    idsByModel.get(name)?.add(doc._id.toHexString());
  }

  // Referential integrity via schema `ref` metadata (scalar and array refs).
  for (const { model, doc } of ops) {
    model.schema.eachPath((path, type) => {
      const opts = (type as unknown as { options?: { ref?: string } }).options;
      const caster = (type as unknown as { caster?: { options?: { ref?: string } } }).caster;
      const ref = opts?.ref ?? caster?.options?.ref;
      if (!ref || ref === 'File' || ref === 'PipelineStage') return; // stages & files live outside the demo set
      const value = (doc as Record<string, unknown>)[path];
      const values = Array.isArray(value) ? value : value == null ? [] : [value];
      for (const v of values) {
        const hex = String((v as { toHexString?: () => string }).toHexString?.() ?? v);
        if (!idsByModel.get(ref)?.has(hex)) {
          problems.push(`${model.modelName}.${path} -> ${ref} ${hex} not found (doc ${doc._id.toHexString()})`);
        }
      }
    });
  }

  // Financial integrity.
  const payments = ops.filter((o) => o.model.modelName === 'Payment');
  for (const { doc: inv } of ops.filter((o) => o.model.modelName === 'Invoice')) {
    const sum = payments
      .filter((p) => String(p.doc.invoiceId) === String(inv._id) && p.doc.status === 'recorded')
      .reduce((s, p) => s + (p.doc.amountCents as number), 0);
    const total = inv.totalCents as number;
    const paid = inv.amountPaidCents as number;
    const status = inv.status as string;
    const num = String(inv.number);
    if (sum !== paid) problems.push(`Invoice ${num}: amountPaid ${paid} != payments ${sum}`);
    const lineSum = (inv.lineItems as Array<{ amountCents: number }>).reduce((s, l) => s + l.amountCents, 0);
    if (lineSum !== (inv.subtotalCents as number)) problems.push(`Invoice ${num}: lines != subtotal`);
    if (total !== (inv.subtotalCents as number) - (inv.discountCents as number) + (inv.taxCents as number)) {
      problems.push(`Invoice ${num}: total mismatch`);
    }
    if (paid > total) problems.push(`Invoice ${num}: overpaid`);
    if (status === 'paid' && paid !== total) problems.push(`Invoice ${num}: paid status but balance`);
    if (status === 'partially_paid' && !(paid > 0 && paid < total)) problems.push(`Invoice ${num}: bad partially_paid`);
    if ((status === 'draft' || status === 'sent' || status === 'overdue') && paid !== 0) {
      problems.push(`Invoice ${num}: ${status} with payments`);
    }
  }

  // Estimate / proposal totals.
  for (const o of ops.filter((x) => ['Estimate', 'Proposal'].includes(x.model.modelName))) {
    const d = o.doc;
    const lines = d.lineItems as Array<{ amountCents: number }>;
    const sub = lines.reduce((s, l) => s + l.amountCents, 0);
    if (sub !== d.subtotalCents) problems.push(`${o.model.modelName} ${String(d.number)}: subtotal mismatch`);
    if ((d.subtotalCents as number) - (d.discountCents as number) + (d.taxCents as number) !== d.totalCents) {
      problems.push(`${o.model.modelName} ${String(d.number)}: total mismatch`);
    }
  }

  for (const { doc } of ops.filter((o) => o.model.modelName === 'Lead')) {
    if (doc.convertedCustomerId && !doc.convertedAt) {
      problems.push(`Lead ${doc._id.toHexString()}: converted without date`);
    }
  }
  return problems;
}
