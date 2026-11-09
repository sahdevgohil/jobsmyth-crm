import mongoose from 'mongoose';
import type { Role } from '../../config/permissions.js';
import { ActivityModel } from '../activities/activity.model.js';
import { AppointmentModel } from '../appointments/appointment.model.js';
import { CustomerModel } from '../customers/customer.model.js';
import { InspectionModel } from '../inspections/inspection.model.js';
import { InvoiceModel } from '../invoices/invoice.model.js';
import { LeadModel } from '../leads/lead.model.js';
import { ProjectModel, ProjectTaskModel } from '../projects/project.model.js';
import { PipelineStageModel } from '../settings/pipeline-stage.model.js';
import { UserModel } from '../users/user.model.js';
import { WorkOrderModel } from '../work-orders/work-order.model.js';

export type AuthContext = { userId: string; role: Role };

export function leadScope(auth: AuthContext): Record<string, unknown> {
  if (auth.role === 'admin') return {};
  return { assignedTo: new mongoose.Types.ObjectId(auth.userId) };
}

export function customerScope(auth: AuthContext): Record<string, unknown> {
  if (auth.role === 'admin') return {};
  return { ownerId: new mongoose.Types.ObjectId(auth.userId) };
}

export async function ownedCustomerIds(auth: AuthContext): Promise<unknown[] | null> {
  if (auth.role === 'admin') return null;
  return CustomerModel.find({ ownerId: auth.userId }).distinct('_id');
}

export function rangeIso(from: Date, to: Date) {
  return { from: from.toISOString(), to: to.toISOString() };
}

function countsByKey(
  rows: Array<{ _id: string | null; count: number }>,
): Array<{ key: string; count: number }> {
  return rows.map((r) => ({ key: r._id ?? 'unknown', count: r.count }));
}

export async function getSalesAnalytics(input: {
  auth: AuthContext;
  from: Date;
  to: Date;
}) {
  const scope = leadScope(input.auth);
  const dateFilter = { createdAt: { $gte: input.from, $lte: input.to } };
  const filter = { ...scope, ...dateFilter };

  const [bySource, byStage, bySalesperson, converted, wonStages, lostStages, followUps] =
    await Promise.all([
      LeadModel.aggregate<{ _id: string; count: number }>([
        { $match: filter },
        { $group: { _id: '$sourceKey', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      LeadModel.aggregate<{ _id: unknown; count: number }>([
        { $match: filter },
        { $group: { _id: '$stageId', count: { $sum: 1 } } },
      ]),
      LeadModel.aggregate<{ _id: unknown; count: number }>([
        { $match: filter },
        { $group: { _id: '$assignedTo', count: { $sum: 1 } } },
      ]),
      LeadModel.countDocuments({
        ...scope,
        convertedAt: { $gte: input.from, $lte: input.to },
      }),
      PipelineStageModel.find({ pipeline: 'lead', category: 'won', isActive: true }).select({
        _id: 1,
      }),
      PipelineStageModel.find({ pipeline: 'lead', category: 'lost', isActive: true }).select({
        _id: 1,
      }),
      ActivityModel.aggregate<{
        _id: null;
        total: number;
        completed: number;
        overdue: number;
      }>([
        {
          $match: {
            type: 'follow_up',
            createdAt: { $gte: input.from, $lte: input.to },
            ...(input.auth.role === 'admin'
              ? {}
              : { assignedTo: new mongoose.Types.ObjectId(input.auth.userId) }),
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            completed: {
              $sum: { $cond: [{ $ne: ['$completedAt', null] }, 1, 0] },
            },
            overdue: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ['$completedAt', null] },
                      { $lt: ['$dueAt', new Date()] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ]),
    ]);

  const wonIds = wonStages.map((s) => s._id);
  const lostIds = lostStages.map((s) => s._id);
  const [won, lost, totalInRange] = await Promise.all([
    LeadModel.countDocuments({ ...scope, stageId: { $in: wonIds }, updatedAt: { $gte: input.from, $lte: input.to } }),
    LeadModel.countDocuments({ ...scope, stageId: { $in: lostIds }, updatedAt: { $gte: input.from, $lte: input.to } }),
    LeadModel.countDocuments(filter),
  ]);

  const stageIdToName = new Map(
    (
      await PipelineStageModel.find({
        _id: { $in: byStage.map((r) => r._id) },
      }).select({ _id: 1, name: 1 })
    ).map((s) => [s._id.toString(), s.name]),
  );

  const userIds = bySalesperson.map((r) => r._id);
  const users = await UserModel.find({ _id: { $in: userIds } }).select({
    _id: 1,
    firstName: 1,
    lastName: 1,
  });
  const userNames = new Map(
    users.map((u) => [u._id.toString(), `${u.firstName} ${u.lastName}`]),
  );

  const follow = followUps[0] ?? { total: 0, completed: 0, overdue: 0 };

  return {
    range: rangeIso(input.from, input.to),
    totalLeads: totalInRange,
    leadsBySource: countsByKey(bySource),
    leadsByStage: byStage.map((r) => ({
      key: r._id ? String(r._id) : 'unknown',
      label: r._id ? (stageIdToName.get(String(r._id)) ?? 'unknown') : 'unknown',
      count: r.count,
    })),
    leadsBySalesperson: bySalesperson.map((r) => ({
      key: r._id ? String(r._id) : 'unknown',
      label: r._id ? (userNames.get(String(r._id)) ?? 'unknown') : 'unknown',
      count: r.count,
    })),
    convertedLeads: converted,
    conversionRate: totalInRange === 0 ? 0 : converted / totalInRange,
    won,
    lost,
    followUpPerformance: {
      total: follow.total,
      completed: follow.completed,
      overdue: follow.overdue,
      completionRate: follow.total === 0 ? 0 : follow.completed / follow.total,
    },
  };
}

export async function getOperationsAnalytics(input: {
  auth: AuthContext;
  from: Date;
  to: Date;
}) {
  const customerIds = await ownedCustomerIds(input.auth);
  const customerFilter = customerIds ? { customerId: { $in: customerIds } } : {};
  const now = new Date();

  const appointmentMatch =
    input.auth.role === 'admin'
      ? { startAt: { $gte: input.from, $lte: input.to } }
      : {
          startAt: { $gte: input.from, $lte: input.to },
          assignedTo: input.auth.userId,
        };

  const [
    appointmentsByStatus,
    inspectionsCompleted,
    projectsByStatus,
    delayedProjects,
    tasksByStatus,
    workOrdersByStatus,
    subcontractorWorkload,
  ] = await Promise.all([
    AppointmentModel.aggregate<{ _id: string; count: number }>([
      { $match: appointmentMatch },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    InspectionModel.countDocuments({
      ...customerFilter,
      status: 'completed',
      inspectionDate: { $gte: input.from, $lte: input.to },
    }),
    ProjectModel.aggregate<{ _id: string; count: number }>([
      { $match: { ...customerFilter } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    ProjectModel.countDocuments({
      ...customerFilter,
      status: { $nin: ['completed', 'closed', 'cancelled'] },
      plannedEndAt: { $lt: now },
    }),
    ProjectTaskModel.aggregate<{ _id: string; count: number }>([
      ...(customerIds
        ? [
            {
              $lookup: {
                from: 'projects',
                localField: 'projectId',
                foreignField: '_id',
                as: 'project',
              },
            },
            { $unwind: '$project' },
            { $match: { 'project.customerId': { $in: customerIds } } },
          ]
        : []),
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    WorkOrderModel.aggregate<{ _id: string; count: number }>([
      ...(customerIds
        ? [
            {
              $lookup: {
                from: 'projects',
                localField: 'projectId',
                foreignField: '_id',
                as: 'project',
              },
            },
            { $unwind: '$project' },
            { $match: { 'project.customerId': { $in: customerIds } } },
          ]
        : []),
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    WorkOrderModel.aggregate<{ _id: unknown; count: number }>([
      {
        $match: {
          subcontractorId: { $ne: null },
          status: { $nin: ['completed', 'cancelled'] },
        },
      },
      ...(customerIds
        ? [
            {
              $lookup: {
                from: 'projects',
                localField: 'projectId',
                foreignField: '_id',
                as: 'project',
              },
            },
            { $unwind: '$project' },
            { $match: { 'project.customerId': { $in: customerIds } } },
          ]
        : []),
      { $group: { _id: '$subcontractorId', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 50 },
    ]),
  ]);

  const activeProjects = await ProjectModel.countDocuments({
    ...customerFilter,
    status: {
      $in: [
        'approved',
        'planning',
        'scheduled',
        'materials_preparation',
        'in_progress',
        'on_hold',
        'quality_review',
      ],
    },
  });

  return {
    range: rangeIso(input.from, input.to),
    appointmentsByStatus: countsByKey(appointmentsByStatus),
    completedInspections: inspectionsCompleted,
    projectsByStatus: countsByKey(projectsByStatus),
    activeProjects,
    delayedProjects,
    tasksByStatus: countsByKey(tasksByStatus),
    workOrdersByStatus: countsByKey(workOrdersByStatus),
    subcontractorWorkload: subcontractorWorkload.map((r) => ({
      subcontractorId: r._id ? String(r._id) : null,
      openWorkOrders: r.count,
    })),
  };
}

export async function getFinanceAnalytics(input: {
  auth: AuthContext;
  from: Date;
  to: Date;
}) {
  const customerIds = await ownedCustomerIds(input.auth);
  const match: Record<string, unknown> = {
    status: { $ne: 'void' },
    invoiceDate: { $gte: input.from, $lte: input.to },
  };
  if (customerIds) match.customerId = { $in: customerIds };

  const [agg] = await InvoiceModel.aggregate<{
    invoicedCents: number;
    collectedCents: number;
    outstandingCents: number;
    overdueCount: number;
  }>([
    { $match: match },
    {
      $group: {
        _id: null,
        invoicedCents: {
          $sum: {
            $cond: [{ $eq: ['$status', 'draft'] }, 0, '$totalCents'],
          },
        },
        collectedCents: {
          $sum: {
            $cond: [{ $eq: ['$status', 'draft'] }, 0, '$amountPaidCents'],
          },
        },
        outstandingCents: {
          $sum: {
            $cond: [
              { $eq: ['$status', 'draft'] },
              0,
              { $max: [0, { $subtract: ['$totalCents', '$amountPaidCents'] }] },
            ],
          },
        },
        overdueCount: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $ne: ['$status', 'draft'] },
                  { $ne: ['$status', 'paid'] },
                  { $lt: ['$dueDate', new Date()] },
                  { $lt: ['$amountPaidCents', '$totalCents'] },
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
  ]);

  const revenueByDay = await InvoiceModel.aggregate<{ _id: string; revenueCents: number }>([
    {
      $match: {
        ...match,
        status: { $nin: ['void', 'draft'] },
      },
    },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$invoiceDate' },
        },
        revenueCents: { $sum: '$totalCents' },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return {
    range: rangeIso(input.from, input.to),
    invoicedCents: agg?.invoicedCents ?? 0,
    collectedCents: agg?.collectedCents ?? 0,
    outstandingCents: agg?.outstandingCents ?? 0,
    overdueCount: agg?.overdueCount ?? 0,
    revenueByDay: revenueByDay.map((r) => ({
      date: r._id,
      revenueCents: r.revenueCents,
    })),
  };
}
