import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { buildDemoOps, demoId } from './demo-data.js';
import { verifyDemoOps } from './demo-verify.js';

const STAGES = ['New', 'Contacted', 'Appointment Set', 'Inspected', 'Estimate Sent', 'Won', 'Lost'];
const stageIds = Object.fromEntries(STAGES.map((n) => [n, new mongoose.Types.ObjectId()]));
const now = new Date('2026-11-05T18:00:00.000Z');

function count(ops: ReturnType<typeof buildDemoOps>, model: string): number {
  return ops.filter((o) => o.model.modelName === model).length;
}

describe('demo dataset', () => {
  const ops = buildDemoOps({ now, passwordHash: 'x', stageIds });

  it('is internally consistent (refs, money, statuses)', () => {
    expect(verifyDemoOps(ops)).toEqual([]);
  });

  it('is deterministic: same inputs give the same ids', () => {
    const again = buildDemoOps({ now, passwordHash: 'x', stageIds });
    expect(again.map((o) => String(o.doc._id))).toEqual(ops.map((o) => String(o.doc._id)));
  });

  it('has the requested volumes', () => {
    expect(count(ops, 'User')).toBe(4);
    expect(count(ops, 'Lead')).toBe(36);
    expect(count(ops, 'Customer')).toBeGreaterThanOrEqual(15);
    expect(count(ops, 'Customer')).toBeLessThanOrEqual(25);
    expect(count(ops, 'Property')).toBeGreaterThanOrEqual(20);
    expect(count(ops, 'Project')).toBe(7);
    expect(count(ops, 'Subcontractor')).toBeGreaterThanOrEqual(5);
  });

  it('covers every invoice status and never fakes provider delivery', () => {
    const statuses = new Set(ops.filter((o) => o.model.modelName === 'Invoice').map((o) => o.doc.status));
    for (const s of ['draft', 'sent', 'partially_paid', 'paid', 'overdue']) expect(statuses.has(s)).toBe(true);
    const comms = ops.filter((o) => o.model.modelName === 'Communication');
    for (const c of comms.filter((x) => x.doc.channel !== 'internal_note')) {
      expect(c.doc.deliveryStatus).toBe('not_configured');
    }
    for (const p of ops.filter((o) => o.model.modelName === 'Proposal')) {
      expect(p.doc.signature).toMatchObject({ status: 'not_requested', provider: 'none' });
    }
  });

  it('covers the requested project statuses', () => {
    const statuses = new Set(ops.filter((o) => o.model.modelName === 'Project').map((o) => o.doc.status));
    for (const s of ['planning', 'scheduled', 'in_progress', 'on_hold', 'quality_review', 'completed']) {
      expect(statuses.has(s)).toBe(true);
    }
  });

  it('produces stable ids from keys', () => {
    expect(String(demoId('x'))).toBe(String(demoId('x')));
    expect(String(demoId('x'))).not.toBe(String(demoId('y')));
  });

  it('keeps all appointments for one assignee conflict-free', () => {
    const appts = ops
      .filter((o) => o.model.modelName === 'Appointment' && !['cancelled', 'completed'].includes(String(o.doc.status)))
      .map((o) => ({ who: String(o.doc.assignedTo), s: (o.doc.startAt as Date).getTime(), e: (o.doc.endAt as Date).getTime() }));
    for (const a of appts) {
      for (const b of appts) {
        if (a === b || a.who !== b.who) continue;
        expect(a.s < b.e && b.s < a.e).toBe(false);
      }
    }
  });
});
