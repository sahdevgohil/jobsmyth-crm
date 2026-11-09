import mongoose from 'mongoose';
import { recordAudit } from '../../services/audit.js';
import { AppError } from '../../utils/errors.js';
import {
  LEAD_STAGE_CATEGORIES,
  PipelineStageModel,
  type LeadStageCategory,
  type PipelineStageDocument,
} from './pipeline-stage.model.js';

export type PipelineStageDto = {
  id: string;
  pipeline: string;
  name: string;
  category: string;
  order: number;
  isActive: boolean;
};

function toDto(doc: PipelineStageDocument): PipelineStageDto {
  return {
    id: doc._id.toString(),
    pipeline: doc.pipeline,
    name: doc.name,
    category: doc.category,
    order: doc.order,
    isActive: doc.isActive,
  };
}

export async function listPipelineStages(
  pipeline: 'lead' | 'project' = 'lead',
  includeInactive = false,
): Promise<PipelineStageDto[]> {
  const filter: Record<string, unknown> = { pipeline };
  if (!includeInactive) {
    filter.isActive = true;
  }
  const rows = await PipelineStageModel.find(filter).sort({ order: 1, name: 1 });
  return rows.map(toDto);
}

export async function getLeadStageById(id: string): Promise<PipelineStageDocument> {
  if (!mongoose.isValidObjectId(id)) {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Stage not found.' });
  }
  const stage = await PipelineStageModel.findOne({ _id: id, pipeline: 'lead' });
  if (!stage) {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Stage not found.' });
  }
  return stage;
}

export async function getDefaultOpenLeadStage(): Promise<PipelineStageDocument> {
  const stage = await PipelineStageModel.findOne({
    pipeline: 'lead',
    category: 'open',
    isActive: true,
  }).sort({ order: 1 });
  if (!stage) {
    throw new AppError({
      status: 422,
      code: 'NO_OPEN_STAGE',
      message: 'No active open lead stage is configured.',
    });
  }
  return stage;
}

export async function getWonLeadStage(): Promise<PipelineStageDocument> {
  const stage = await PipelineStageModel.findOne({
    pipeline: 'lead',
    category: 'won',
    isActive: true,
  }).sort({ order: 1 });
  if (!stage) {
    throw new AppError({
      status: 422,
      code: 'NO_WON_STAGE',
      message: 'No active won lead stage is configured.',
    });
  }
  return stage;
}

async function assertSingleWon(excludeId?: string): Promise<void> {
  const filter: Record<string, unknown> = {
    pipeline: 'lead',
    category: 'won',
    isActive: true,
  };
  if (excludeId) {
    filter._id = { $ne: excludeId };
  }
  const count = await PipelineStageModel.countDocuments(filter);
  if (count > 0) {
    throw new AppError({
      status: 422,
      code: 'WON_STAGE_EXISTS',
      message: 'Exactly one active won stage is allowed. Deactivate the existing won stage first.',
    });
  }
}

export async function createPipelineStage(input: {
  pipeline: 'lead';
  name: string;
  category: LeadStageCategory;
  order?: number;
  actorId: string;
  requestId?: string;
  ip?: string;
}): Promise<PipelineStageDto> {
  if (!LEAD_STAGE_CATEGORIES.includes(input.category)) {
    throw new AppError({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Invalid stage category.',
    });
  }
  if (input.category === 'won') {
    await assertSingleWon();
  }

  const order =
    input.order ??
    ((await PipelineStageModel.countDocuments({ pipeline: 'lead' })) + 1);

  try {
    const row = await PipelineStageModel.create({
      pipeline: 'lead',
      name: input.name.trim(),
      category: input.category,
      order,
      isActive: true,
    });

    await recordAudit({
      actorType: 'user',
      actorId: input.actorId,
      action: 'pipeline_stage.created',
      entityType: 'pipelineStage',
      entityId: row._id.toString(),
      changes: { name: row.name, category: row.category, order: row.order },
      requestId: input.requestId,
      ip: input.ip,
    });

    return toDto(row);
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code: number }).code === 11000
    ) {
      throw new AppError({
        status: 409,
        code: 'STAGE_NAME_EXISTS',
        message: 'A stage with this name already exists.',
      });
    }
    throw error;
  }
}

export async function updatePipelineStage(input: {
  id: string;
  name?: string;
  category?: LeadStageCategory;
  order?: number;
  isActive?: boolean;
  actorId: string;
  requestId?: string;
  ip?: string;
}): Promise<PipelineStageDto> {
  const row = await getLeadStageById(input.id);
  const before = toDto(row);

  if (input.category !== undefined) {
    if (!LEAD_STAGE_CATEGORIES.includes(input.category)) {
      throw new AppError({
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'Invalid stage category.',
      });
    }
    if (input.category === 'won' && (input.isActive !== false && row.isActive)) {
      await assertSingleWon(row._id.toString());
    }
    row.category = input.category;
  }

  if (input.name !== undefined) row.name = input.name.trim();
  if (input.order !== undefined) row.order = input.order;
  if (input.isActive !== undefined) {
    if (input.isActive === false) {
      const { LeadModel } = await import('../leads/lead.model.js');
      const openCount = await LeadModel.countDocuments({
        stageId: row._id,
        convertedCustomerId: null,
      });
      if (openCount > 0) {
        throw new AppError({
          status: 422,
          code: 'STAGE_IN_USE',
          message: `Cannot deactivate stage while ${openCount} open lead(s) remain on it. Move or convert those leads first.`,
        });
      }
    }
    if (
      input.isActive !== false &&
      (input.category === 'won' || row.category === 'won')
    ) {
      await assertSingleWon(row._id.toString());
    }
    row.isActive = input.isActive;
  }

  try {
    await row.save();
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code: number }).code === 11000
    ) {
      throw new AppError({
        status: 409,
        code: 'STAGE_NAME_EXISTS',
        message: 'A stage with this name already exists.',
      });
    }
    throw error;
  }

  await recordAudit({
    actorType: 'user',
    actorId: input.actorId,
    action: input.isActive === false ? 'pipeline_stage.deactivated' : 'pipeline_stage.updated',
    entityType: 'pipelineStage',
    entityId: row._id.toString(),
    changes: { before, after: toDto(row) },
    requestId: input.requestId,
    ip: input.ip,
  });

  return toDto(row);
}

export async function reorderPipelineStages(input: {
  orderedIds: string[];
  actorId: string;
  requestId?: string;
  ip?: string;
}): Promise<PipelineStageDto[]> {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const all = await PipelineStageModel.find({ pipeline: 'lead' })
      .session(session)
      .sort({ order: 1, name: 1 });
    const byId = new Map(all.map((s) => [s._id.toString(), s]));
    const seen = new Set<string>();
    const ordered: string[] = [];

    for (const id of input.orderedIds) {
      if (!byId.has(id)) {
        throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Stage not found.' });
      }
      if (!seen.has(id)) {
        ordered.push(id);
        seen.add(id);
      }
    }
    for (const stage of all) {
      const id = stage._id.toString();
      if (!seen.has(id)) {
        ordered.push(id);
        seen.add(id);
      }
    }

    let order = 1;
    for (const id of ordered) {
      await PipelineStageModel.updateOne(
        { _id: id, pipeline: 'lead' },
        { $set: { order } },
        { session },
      );
      order += 1;
    }
    await recordAudit({
      actorType: 'user',
      actorId: input.actorId,
      action: 'pipeline_stage.reordered',
      entityType: 'pipelineStage',
      entityId: 'lead',
      changes: { orderedIds: ordered },
      requestId: input.requestId,
      ip: input.ip,
      session,
    });
    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
  return listPipelineStages('lead', true);
}
