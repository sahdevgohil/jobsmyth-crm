import { TZDate } from '@date-fns/tz';
import mongoose from 'mongoose';
import { ActivityModel } from '../activities/activity.model.js';
import { AppointmentModel } from '../appointments/appointment.model.js';
import { CustomerModel } from '../customers/customer.model.js';
import { EstimateModel } from '../estimates/estimate.model.js';
import { InspectionModel } from '../inspections/inspection.model.js';
import { InvoiceModel, PaymentModel } from '../invoices/invoice.model.js';
import { LeadModel } from '../leads/lead.model.js';
import { ProjectModel } from '../projects/project.model.js';
import { ProposalModel } from '../proposals/proposal.model.js';
import { CompanySettingsModel } from '../settings/company-settings.model.js';
import { PipelineStageModel } from '../settings/pipeline-stage.model.js';
import { UserModel } from '../users/user.model.js';
import { customerScope, leadScope, ownedCustomerIds, rangeIso, type AuthContext } from './analytics.service.js';

const DAY = 86_400_000;
const ACTIVE_PROJECT_STATUSES = [
  'approved',
  'planning',
  'scheduled',
  'materials_preparation',
  'in_progress',
  'on_hold',
  'quality_review',
];
const OPEN_APPOINTMENT_STATUSES = ['scheduled', 'confirmed'];

export type TimelineItem = {
  id: string;
  kind: 'lead' | 'customer' | 'appointment' | 'inspection' | 'estimate' | 'proposal' | 'project' | 'payment';
  title: string;
  detail: string;
  at: string;
  href: string;
};

export type ScheduleItem = {
  id: string;
  kind: 'appointment' | 'inspection' | 'project_start' | 'project_end' | 'follow_up';
  title: string;
  subtitle: string;
  at: string;
  href: string;
  overdue: boolean;
};

export type DashboardDto = {
  range: { from: string; to: string };
  /** True when the caller's scope has no leads or customers at all (drives the onboarding state). */
  isEmpty: boolean;
  tiles: {
    totalLeads: number;
    newLeads: number;
    activeLeads: number;
    convertedLeads: number;
    totalCustomers: number;
    overdueFollowUps: number;
    upcomingAppointments: number;
    activeProjects: number;
    outstandingInvoicesCents: number;
    outstandingInvoicesCount: number;
    overdueInvoicesCount: number;
  };
  pipeline: Array<{ stageId: string; name: string; category: string; order: number; count: number }>;
  salesPerformance: Array<{
    userId: string;
    name: string;
    leadsAssigned: number;
    leadsConverted: number;
    won: number;
    lost: number;
    conversionRate: number;
  }>;
  revenue: {
    invoicedCents: number;
    collectedCents: number;
    outstandingCents: number;
    granularity: 'day' | 'week' | 'month';
    trend: Array<{ period: string; invoicedCents: number; collectedCents: number }>;
  };
  recentActivities: TimelineItem[];
  schedule: {
    today: ScheduleItem[];
    upcoming: ScheduleItem[];
    followUps: ScheduleItem[];
  };
};

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function oid(id: unknown): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(String(id));
}

/** [start, end) of the current day in the company time zone. */
function todayBounds(now: Date, timeZone: string): { start: Date; end: Date } {
  const local = new TZDate(now, timeZone);
  const start = new TZDate(local.getFullYear(), local.getMonth(), local.getDate(), 0, 0, 0, timeZone);
  const end = new TZDate(local.getFullYear(), local.getMonth(), local.getDate() + 1, 0, 0, 0, timeZone);
  return { start: new Date(start.getTime()), end: new Date(end.getTime()) };
}

function granularityFor(from: Date, to: Date): 'day' | 'week' | 'month' {
  const days = (to.getTime() - from.getTime()) / DAY;
  if (days <= 35) return 'day';
  if (days <= 120) return 'week';
  return 'month';
}

function bucketKey(date: Date, g: 'day' | 'week' | 'month'): string {
  const d = new Date(date);
  if (g === 'month') return d.toISOString().slice(0, 7);
  if (g === 'week') {
    const day = d.getUTCDay() || 7; // ISO week starts Monday
    d.setUTCDate(d.getUTCDate() - day + 1);
  }
  return d.toISOString().slice(0, 10);
}

function fillBuckets(from: Date, to: Date, g: 'day' | 'week' | 'month'): string[] {
  const keys: string[] = [];
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  let guard = 0;
  while (cursor <= to && guard++ < 400) {
    const key = bucketKey(cursor, g);
    if (keys[keys.length - 1] !== key) keys.push(key);
    if (g === 'month') cursor.setUTCMonth(cursor.getUTCMonth() + 1, 1);
    else cursor.setUTCDate(cursor.getUTCDate() + (g === 'week' ? 7 : 1));
  }
  const last = bucketKey(to, g);
  if (keys[keys.length - 1] !== last) keys.push(last);
  return keys;
}

export async function getDashboard(input: {
  auth: AuthContext;
  from: Date;
  to: Date;
  now?: Date;
}): Promise<DashboardDto> {
  const { auth, from, to } = input;
  const now = input.now ?? new Date();
  const isAdmin = auth.role === 'admin';
  const leadFilter = leadScope(auth);
  const customerFilter = customerScope(auth);
  const ownedIds = await ownedCustomerIds(auth);
  const byCustomer = ownedIds ? { customerId: { $in: ownedIds } } : {};
  const settings = await CompanySettingsModel.findOne().select({ timezone: 1 });
  const timeZone = settings?.timezone ?? 'America/Chicago';
  const day = todayBounds(now, timeZone);

  const stages = await PipelineStageModel.find({ pipeline: 'lead', isActive: true }).sort({ order: 1 });
  const stageById = new Map(stages.map((s) => [s._id.toString(), s]));
  const openStageIds = stages.filter((s) => s.category === 'open').map((s) => s._id);
  const firstOpen = stages.find((s) => s.category === 'open');
  const inRange = { createdAt: { $gte: from, $lte: to } };

  const [
    totalLeads,
    newLeads,
    activeLeads,
    convertedLeads,
    totalCustomers,
    allLeadCount,
    scopedLeadIds,
    leadsByStage,
    leadsByUserStage,
    convertedByUser,
    upcomingAppointments,
    activeProjects,
    outstanding,
  ] = await Promise.all([
    LeadModel.countDocuments({ ...leadFilter, ...inRange }),
    firstOpen
      ? LeadModel.countDocuments({ ...leadFilter, ...inRange, stageId: firstOpen._id })
      : Promise.resolve(0),
    LeadModel.countDocuments({ ...leadFilter, ...inRange, stageId: { $in: openStageIds } }),
    LeadModel.countDocuments({ ...leadFilter, convertedAt: { $gte: from, $lte: to } }),
    CustomerModel.countDocuments({ ...customerFilter, archivedAt: null }),
    LeadModel.countDocuments(leadFilter),
    LeadModel.find(leadFilter).distinct('_id'),
    LeadModel.aggregate<{ _id: mongoose.Types.ObjectId; count: number }>([
      { $match: { ...leadFilter, ...inRange } },
      { $group: { _id: '$stageId', count: { $sum: 1 } } },
    ]),
    LeadModel.aggregate<{ _id: { u: mongoose.Types.ObjectId; s: mongoose.Types.ObjectId }; count: number }>([
      { $match: { ...leadFilter, ...inRange } },
      { $group: { _id: { u: '$assignedTo', s: '$stageId' }, count: { $sum: 1 } } },
    ]),
    LeadModel.aggregate<{ _id: mongoose.Types.ObjectId; count: number }>([
      { $match: { ...leadFilter, convertedAt: { $gte: from, $lte: to } } },
      { $group: { _id: '$assignedTo', count: { $sum: 1 } } },
    ]),
    AppointmentModel.countDocuments({
      startAt: { $gte: now },
      status: { $in: OPEN_APPOINTMENT_STATUSES },
      ...(isAdmin ? {} : { assignedTo: oid(auth.userId) }),
    }),
    ProjectModel.countDocuments({ ...byCustomer, status: { $in: ACTIVE_PROJECT_STATUSES } }),
    InvoiceModel.aggregate<{ _id: null; cents: number; count: number; overdue: number }>([
      { $match: { ...byCustomer, status: { $nin: ['void', 'draft', 'paid'] } } },
      {
        $group: {
          _id: null,
          cents: { $sum: { $max: [0, { $subtract: ['$totalCents', '$amountPaidCents'] }] } },
          count: { $sum: { $cond: [{ $lt: ['$amountPaidCents', '$totalCents'] }, 1, 0] } },
          overdue: {
            $sum: {
              $cond: [
                { $and: [{ $lt: ['$dueDate', now] }, { $lt: ['$amountPaidCents', '$totalCents'] }] },
                1,
                0,
              ],
            },
          },
        },
      },
    ]),
  ]);

  const overdueFollowUps = await ActivityModel.countDocuments({
    entityType: 'lead',
    entityId: { $in: scopedLeadIds },
    type: 'follow_up',
    completedAt: null,
    dueAt: { $lt: now },
  });

  // ------------------------------------------------------------ pipeline
  const stageCounts = new Map(leadsByStage.map((r) => [String(r._id), r.count]));
  const pipeline = stages.map((s) => ({
    stageId: s._id.toString(),
    name: s.name,
    category: s.category,
    order: s.order,
    count: stageCounts.get(s._id.toString()) ?? 0,
  }));

  // ------------------------------------------------------------ sales performance
  const salespeople = await UserModel.find({
    isActive: true,
    ...(isAdmin ? { role: 'salesperson' } : { _id: oid(auth.userId) }),
  }).select({ firstName: 1, lastName: 1 });
  const perUser = new Map<string, { assigned: number; won: number; lost: number }>();
  for (const row of leadsByUserStage) {
    const key = String(row._id.u);
    const entry = perUser.get(key) ?? { assigned: 0, won: 0, lost: 0 };
    entry.assigned += row.count;
    const category = stageById.get(String(row._id.s))?.category;
    if (category === 'won') entry.won += row.count;
    if (category === 'lost') entry.lost += row.count;
    perUser.set(key, entry);
  }
  const convertedMap = new Map(convertedByUser.map((r) => [String(r._id), r.count]));
  const salesPerformance = salespeople
    .map((sp) => {
      const e = perUser.get(sp._id.toString()) ?? { assigned: 0, won: 0, lost: 0 };
      const converted = convertedMap.get(sp._id.toString()) ?? 0;
      return {
        userId: sp._id.toString(),
        name: `${sp.firstName} ${sp.lastName}`,
        leadsAssigned: e.assigned,
        leadsConverted: converted,
        won: e.won,
        lost: e.lost,
        conversionRate: e.assigned === 0 ? 0 : Math.min(1, converted / e.assigned),
      };
    })
    .sort((a, b) => b.leadsAssigned - a.leadsAssigned);

  // ------------------------------------------------------------ revenue
  const invoiceMatch = {
    ...byCustomer,
    status: { $nin: ['void', 'draft'] },
    invoiceDate: { $gte: from, $lte: to },
  };
  const granularity = granularityFor(from, to);
  const [invoiceTotals, invoiceDocs, paymentDocs] = await Promise.all([
    InvoiceModel.aggregate<{ _id: null; invoiced: number; collected: number }>([
      { $match: invoiceMatch },
      { $group: { _id: null, invoiced: { $sum: '$totalCents' }, collected: { $sum: '$amountPaidCents' } } },
    ]),
    InvoiceModel.find(invoiceMatch).select({ invoiceDate: 1, totalCents: 1 }).lean(),
    PaymentModel.find({ ...byCustomer, status: 'recorded', paymentDate: { $gte: from, $lte: to } })
      .select({ paymentDate: 1, amountCents: 1 })
      .lean(),
  ]);
  const trendMap = new Map<string, { invoicedCents: number; collectedCents: number }>(
    fillBuckets(from, to, granularity).map((k) => [k, { invoicedCents: 0, collectedCents: 0 }]),
  );
  for (const inv of invoiceDocs) {
    const e = trendMap.get(bucketKey(inv.invoiceDate, granularity));
    if (e) e.invoicedCents += inv.totalCents;
  }
  for (const p of paymentDocs) {
    const e = trendMap.get(bucketKey(p.paymentDate, granularity));
    if (e) e.collectedCents += p.amountCents;
  }
  const invoicedCents = invoiceTotals[0]?.invoiced ?? 0;
  const collectedCents = invoiceTotals[0]?.collected ?? 0;
  const out = outstanding[0];

  // ------------------------------------------------------------ recent activity (derived from source records)
  const scopedLeadObjectIds = scopedLeadIds as mongoose.Types.ObjectId[];
  const [acts, appts, insps, ests, props, projs, pays] = await Promise.all([
    ActivityModel.find({
      entityType: 'lead',
      entityId: { $in: scopedLeadObjectIds },
      type: { $in: ['system', 'conversion', 'assignment', 'stage_change', 'note', 'call'] },
    })
      .sort({ createdAt: -1 })
      .limit(12)
      .lean(),
    AppointmentModel.find(isAdmin ? {} : { assignedTo: oid(auth.userId) })
      .sort({ createdAt: -1 })
      .limit(8)
      .lean(),
    InspectionModel.find({ ...byCustomer, status: 'completed' }).sort({ updatedAt: -1 }).limit(8).lean(),
    EstimateModel.find(byCustomer).sort({ createdAt: -1 }).limit(8).lean(),
    ProposalModel.find({ ...byCustomer, status: { $in: ['sent', 'viewed', 'accepted', 'rejected'] } })
      .sort({ updatedAt: -1 })
      .limit(8)
      .lean(),
    ProjectModel.find(byCustomer).sort({ createdAt: -1 }).limit(8).lean(),
    PaymentModel.find({ ...byCustomer, status: 'recorded' }).sort({ paymentDate: -1 }).limit(8).lean(),
  ]);
  const leadNames = new Map(
    (
      await LeadModel.find({ _id: { $in: acts.map((a) => a.entityId) } })
        .select({ firstName: 1, lastName: 1, companyName: 1 })
        .lean()
    ).map((l) => [String(l._id), l.companyName || `${l.firstName} ${l.lastName}`.trim() || 'Lead']),
  );
  const timeline: TimelineItem[] = [
    ...acts.map((a): TimelineItem => ({
      id: `act-${a._id}`,
      kind: 'lead',
      title: a.body || a.type,
      detail: leadNames.get(String(a.entityId)) ?? 'Lead',
      at: a.createdAt.toISOString(),
      href: `/app/leads/${a.entityId}`,
    })),
    ...appts.map((a): TimelineItem => ({
      id: `appt-${a._id}`,
      kind: 'appointment',
      title: a.status === 'cancelled' ? 'Appointment cancelled' : 'Appointment scheduled',
      detail: a.title,
      at: (a.createdAt ?? a.startAt).toISOString(),
      href: `/app/appointments/${a._id}`,
    })),
    ...insps.map((i): TimelineItem => ({
      id: `insp-${i._id}`,
      kind: 'inspection',
      title: 'Inspection completed',
      detail: i.roofCondition || 'Inspection report ready',
      at: i.updatedAt.toISOString(),
      href: `/app/inspections/${i._id}`,
    })),
    ...ests.map((e): TimelineItem => ({
      id: `est-${e._id}`,
      kind: 'estimate',
      title: 'Estimate generated',
      detail: `${e.number} · ${money(e.totalCents)}`,
      at: e.createdAt.toISOString(),
      href: `/app/estimates/${e._id}`,
    })),
    ...props.map((p): TimelineItem => ({
      id: `prop-${p._id}`,
      kind: 'proposal',
      title:
        p.status === 'accepted' ? 'Proposal approved' : p.status === 'rejected' ? 'Proposal rejected' : 'Proposal sent',
      detail: `${p.number} · ${money(p.totalCents)}`,
      at: p.updatedAt.toISOString(),
      href: `/app/proposals/${p._id}`,
    })),
    ...projs.map((p): TimelineItem => ({
      id: `proj-${p._id}`,
      kind: 'project',
      title: 'Project created',
      detail: p.number,
      at: p.createdAt.toISOString(),
      href: `/app/projects/${p._id}`,
    })),
    ...pays.map((p): TimelineItem => ({
      id: `pay-${p._id}`,
      kind: 'payment',
      title: 'Payment recorded',
      detail: `${money(p.amountCents)} · ${p.method}`,
      at: p.paymentDate.toISOString(),
      href: `/app/invoices/${p.invoiceId}`,
    })),
  ]
    .filter((t) => new Date(t.at).getTime() <= now.getTime())
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 14);

  // ------------------------------------------------------------ schedule
  const horizon = new Date(now.getTime() + 14 * DAY);
  const apptScope = isAdmin ? {} : { assignedTo: oid(auth.userId) };
  const [todayAppts, upcomingAppts, startingProjects, endingProjects, followUpDocs] = await Promise.all([
    AppointmentModel.find({
      ...apptScope,
      status: { $in: OPEN_APPOINTMENT_STATUSES },
      startAt: { $gte: day.start, $lt: day.end },
    })
      .sort({ startAt: 1 })
      .limit(10)
      .lean(),
    AppointmentModel.find({
      ...apptScope,
      status: { $in: OPEN_APPOINTMENT_STATUSES },
      startAt: { $gte: day.end, $lte: horizon },
    })
      .sort({ startAt: 1 })
      .limit(8)
      .lean(),
    ProjectModel.find({
      ...byCustomer,
      status: { $in: ['approved', 'planning', 'scheduled', 'materials_preparation'] },
      plannedStartAt: { $gte: day.start, $lte: horizon },
    })
      .sort({ plannedStartAt: 1 })
      .limit(5)
      .lean(),
    ProjectModel.find({
      ...byCustomer,
      status: { $in: ACTIVE_PROJECT_STATUSES },
      plannedEndAt: { $lte: horizon },
    })
      .sort({ plannedEndAt: 1 })
      .limit(5)
      .lean(),
    ActivityModel.find({
      entityType: 'lead',
      entityId: { $in: scopedLeadObjectIds },
      type: 'follow_up',
      completedAt: null,
      dueAt: { $lte: new Date(now.getTime() + 7 * DAY) },
    })
      .sort({ dueAt: 1 })
      .limit(8)
      .lean(),
  ]);
  const followLeadNames = new Map(
    (
      await LeadModel.find({ _id: { $in: followUpDocs.map((f) => f.entityId) } })
        .select({ firstName: 1, lastName: 1, companyName: 1 })
        .lean()
    ).map((l) => [String(l._id), l.companyName || `${l.firstName} ${l.lastName}`.trim() || 'Lead']),
  );
  const apptItem = (a: (typeof todayAppts)[number]): ScheduleItem => ({
    id: `appt-${a._id}`,
    kind: a.typeKey === 'inspection' ? 'inspection' : 'appointment',
    title: a.title,
    subtitle: a.location || a.typeKey.replace(/_/g, ' '),
    at: a.startAt.toISOString(),
    href: `/app/appointments/${a._id}`,
    overdue: false,
  });
  const projectItems: ScheduleItem[] = [
    ...startingProjects.map((p): ScheduleItem => ({
      id: `pstart-${p._id}`,
      kind: 'project_start',
      title: `Project ${p.number} starts`,
      subtitle: p.status.replace(/_/g, ' '),
      at: (p.plannedStartAt as Date).toISOString(),
      href: `/app/projects/${p._id}`,
      overdue: false,
    })),
    ...endingProjects.map((p): ScheduleItem => ({
      id: `pend-${p._id}`,
      kind: 'project_end',
      title: `Project ${p.number} ${(p.plannedEndAt as Date) < now ? 'past planned end' : 'planned completion'}`,
      subtitle: p.status.replace(/_/g, ' '),
      at: (p.plannedEndAt as Date).toISOString(),
      href: `/app/projects/${p._id}`,
      overdue: (p.plannedEndAt as Date) < now,
    })),
  ];

  return {
    range: rangeIso(from, to),
    isEmpty: allLeadCount === 0 && totalCustomers === 0,
    tiles: {
      totalLeads,
      newLeads,
      activeLeads,
      convertedLeads,
      totalCustomers,
      overdueFollowUps,
      upcomingAppointments,
      activeProjects,
      outstandingInvoicesCents: out?.cents ?? 0,
      outstandingInvoicesCount: out?.count ?? 0,
      overdueInvoicesCount: out?.overdue ?? 0,
    },
    pipeline,
    salesPerformance,
    revenue: {
      invoicedCents,
      collectedCents,
      outstandingCents: Math.max(0, invoicedCents - collectedCents),
      granularity,
      trend: [...trendMap].map(([period, v]) => ({ period, ...v })),
    },
    recentActivities: timeline,
    schedule: {
      today: todayAppts.map(apptItem),
      upcoming: [...upcomingAppts.map(apptItem), ...projectItems].sort((a, b) => a.at.localeCompare(b.at)),
      followUps: followUpDocs.map((f): ScheduleItem => ({
        id: `fu-${f._id}`,
        kind: 'follow_up',
        title: f.body || 'Follow up',
        subtitle: followLeadNames.get(String(f.entityId)) ?? 'Lead',
        at: (f.dueAt as Date).toISOString(),
        href: `/app/leads/${f.entityId}`,
        overdue: (f.dueAt as Date) < now,
      })),
    },
  };
}
