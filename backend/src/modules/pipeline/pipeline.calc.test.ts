import { describe, expect, it } from 'vitest';
import { checkTransition, computeFinancials, contractValue, naturalStage, stageValue, type InvoiceLite, type PaymentLite } from './pipeline.calc.js';

const d = (s: string): Date => new Date(`${s}T12:00:00Z`);
const inv = (id: string, total: number, status = 'sent', due = '2026-02-01', date = '2026-01-10'): InvoiceLite => ({ id, status, totalCents: total, invoiceDate: d(date), dueDate: d(due) });
const pay = (invoiceId: string, amountCents: number, date = '2026-01-15'): PaymentLite => ({ invoiceId, amountCents, paymentDate: d(date) });
const NOW = d('2026-01-20');

describe('financials', () => {
  it('partial payment leaves the outstanding balance, not the original invoice amount', () => {
    const f = computeFinancials({ contractCents: 100_000, invoices: [inv('a', 100_000)], payments: [pay('a', 40_000)], asOf: NOW });
    expect(f).toMatchObject({ invoicedCents: 100_000, paidCents: 40_000, outstandingCents: 60_000, paidInFull: false, paymentStatus: 'partial' });
  });
  it('is paid in full only when everything billable is paid', () => {
    expect(computeFinancials({ contractCents: 100_000, invoices: [inv('a', 100_000)], payments: [pay('a', 100_000)], asOf: NOW }).paidInFull).toBe(true);
  });
  it('one paid invoice does not complete a job with another invoice still unpaid', () => {
    const f = computeFinancials({ contractCents: 100_000, invoices: [inv('a', 50_000), inv('b', 50_000)], payments: [pay('a', 50_000)], asOf: NOW });
    expect(f.paidInFull).toBe(false);
    expect(f.outstandingCents).toBe(50_000);
  });
  it('a paid deposit invoice does not complete a part-billed contract: the unbilled remainder stays outstanding', () => {
    const f = computeFinancials({ contractCents: 100_000, invoices: [inv('dep', 30_000, 'paid')], payments: [pay('dep', 30_000)], asOf: NOW });
    expect(f.paidInFull).toBe(false);
    expect(f.outstandingCents).toBe(70_000);
  });
  it('a waiting draft invoice blocks paid-in-full; void and draft invoices never count as invoiced', () => {
    const f = computeFinancials({ contractCents: 50_000, invoices: [inv('a', 50_000, 'paid'), inv('d', 10_000, 'draft'), inv('v', 99_000, 'void')], payments: [pay('a', 50_000)], asOf: NOW });
    expect(f.invoicedCents).toBe(50_000);
    expect(f.hasDraftInvoice).toBe(true);
    expect(f.paidInFull).toBe(false);
  });
  it('change orders raise or lower the contract, never below zero', () => {
    expect(contractValue(100_000, [{ amountCents: 25_000 }, { amountCents: -5_000 }])).toBe(120_000);
    expect(contractValue(10_000, [{ amountCents: -50_000 }])).toBe(0);
    expect(contractValue(100_000, [{ amountCents: 25_000, approvedAt: d('2026-03-01') }], d('2026-02-01'))).toBe(100_000);
  });
  it('reports overdue only for unpaid money past its due date', () => {
    const f = computeFinancials({ contractCents: 100_000, invoices: [inv('a', 60_000, 'sent', '2026-01-05'), inv('b', 40_000, 'sent', '2026-02-20')], payments: [pay('a', 10_000)], asOf: NOW });
    expect(f.overdueCents).toBe(50_000);
    expect(f.paymentStatus).toBe('overdue');
  });
  it('uses integer cents exactly (no floating point drift)', () => {
    const f = computeFinancials({ contractCents: 30, invoices: [inv('a', 10), inv('b', 10), inv('c', 10)], payments: [pay('a', 10), pay('b', 10), pay('c', 10)], asOf: NOW });
    expect(f.paidCents).toBe(30);
    expect(f.paidInFull).toBe(true);
  });
  it('evaluates the ledger as of an earlier date', () => {
    const invoices = [inv('a', 100_000, 'paid', '2026-02-01', '2026-01-10')];
    const payments = [pay('a', 40_000, '2026-01-12'), pay('a', 60_000, '2026-01-18')];
    expect(computeFinancials({ contractCents: 100_000, invoices, payments, asOf: d('2026-01-14') }).outstandingCents).toBe(60_000);
    expect(computeFinancials({ contractCents: 100_000, invoices, payments, asOf: d('2026-01-09') }).issuedInvoiceCount).toBe(0);
  });
});

describe('stage value and natural stage', () => {
  const fin = computeFinancials({ contractCents: 100_000, invoices: [inv('a', 100_000)], payments: [pay('a', 25_000)], asOf: NOW });
  it('each stage contributes one figure', () => {
    expect(stageValue('estimates_out', { estimateCents: 90_000, fin })).toBe(90_000);
    expect(stageValue('jobs_started', { estimateCents: 90_000, fin })).toBe(100_000);
    expect(stageValue('invoiced', { estimateCents: 90_000, fin })).toBe(75_000);
    expect(stageValue('invoices_completed', { estimateCents: 90_000, fin })).toBe(25_000);
  });
  const none = computeFinancials({ contractCents: 100_000, invoices: [], payments: [], asOf: NOW });
  it('follows the project once it exists', () => {
    expect(naturalStage({ estimateStatus: 'sent', projectStatus: null, projectStarted: false, fin: none })).toBe('estimates_out');
    expect(naturalStage({ estimateStatus: 'accepted', projectStatus: null, projectStarted: false, fin: none })).toBe('estimates_accepted');
    expect(naturalStage({ estimateStatus: 'accepted', projectStatus: 'scheduled', projectStarted: false, fin: none })).toBe('estimates_accepted');
    expect(naturalStage({ estimateStatus: 'accepted', projectStatus: 'in_progress', projectStarted: true, fin: none })).toBe('jobs_started');
    expect(naturalStage({ estimateStatus: 'accepted', projectStatus: 'completed', projectStarted: true, fin: none })).toBe('jobs_completed');
    expect(naturalStage({ estimateStatus: 'accepted', projectStatus: 'cancelled', projectStarted: true, fin: none })).toBeNull();
  });
  it('invoices move a completed job only; a deposit invoice does not skip stages', () => {
    expect(naturalStage({ estimateStatus: 'accepted', projectStatus: 'in_progress', projectStarted: true, fin })).toBe('jobs_started');
    expect(naturalStage({ estimateStatus: 'accepted', projectStatus: 'completed', projectStarted: true, fin })).toBe('invoiced');
    const paid = computeFinancials({ contractCents: 100_000, invoices: [inv('a', 100_000, 'paid')], payments: [pay('a', 100_000)], asOf: NOW });
    expect(naturalStage({ estimateStatus: 'accepted', projectStatus: 'closed', projectStarted: true, fin: paid })).toBe('invoices_completed');
  });
});

describe('transition rules', () => {
  const fin = computeFinancials({ contractCents: 100_000, invoices: [], payments: [], asOf: NOW });
  it('one step forward is normal; a jump needs an admin and a reason', () => {
    expect(checkTransition('estimates_out', 'estimates_accepted', { fin, hasReason: false, isAdmin: false })).toEqual({ ok: true, exception: false });
    expect(checkTransition('estimates_out', 'jobs_completed', { fin, hasReason: true, isAdmin: false })).toMatchObject({ ok: false, code: 'EXCEPTION_NOT_ALLOWED' });
    expect(checkTransition('estimates_out', 'jobs_completed', { fin, hasReason: false, isAdmin: true })).toMatchObject({ ok: false, code: 'REASON_REQUIRED' });
    expect(checkTransition('estimates_out', 'jobs_completed', { fin, hasReason: true, isAdmin: true })).toEqual({ ok: true, exception: true });
  });
  it('moving back needs a reason; invoices completed needs a paid ledger or an exception', () => {
    expect(checkTransition('jobs_started', 'estimates_accepted', { fin, hasReason: false, isAdmin: true })).toMatchObject({ ok: false, code: 'REASON_REQUIRED' });
    expect(checkTransition('invoiced', 'invoices_completed', { fin, hasReason: true, isAdmin: true })).toEqual({ ok: true, exception: true });
    expect(checkTransition('invoiced', 'invoices_completed', { fin, hasReason: true, isAdmin: false })).toMatchObject({ ok: false });
    expect(checkTransition('invoiced', 'invoiced', { fin, hasReason: true, isAdmin: true })).toMatchObject({ ok: false, code: 'NO_CHANGE' });
  });
});
