import type { ClientSession, Types } from 'mongoose';
import { UserModel } from '../users/user.model.js';
import { ensureCompanySettings } from '../settings/settings.service.js';
import { CompanySettingsModel } from '../settings/company-settings.model.js';
import { AppError } from '../../utils/errors.js';

const MAX_CAS_ATTEMPTS = 12;

/**
 * Round-robin among active salespeople with receivesLeads (Q-002 working default).
 * Advances companySettings.leadAssignment.lastAssignedUserId with compare-and-set.
 */
export async function assignRoundRobin(session?: ClientSession): Promise<Types.ObjectId> {
  const candidates = await UserModel.find({
    role: 'salesperson',
    isActive: true,
    receivesLeads: true,
  })
    .sort({ _id: 1 })
    .session(session ?? null)
    .select({ _id: 1 });

  if (candidates.length === 0) {
    throw new AppError({
      status: 422,
      code: 'NO_LEAD_RECIPIENTS',
      message: 'No active salespeople are flagged to receive leads.',
    });
  }

  await ensureCompanySettings();

  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
    const settings = await CompanySettingsModel.findOne()
      .session(session ?? null)
      .select({ leadAssignment: 1 });
    if (!settings) {
      throw new AppError({
        status: 500,
        code: 'INTERNAL_ERROR',
        message: 'Company settings missing.',
      });
    }

    const lastId = settings.leadAssignment?.lastAssignedUserId ?? null;
    const lastIdStr = lastId?.toString();
    let index = 0;
    if (lastIdStr) {
      const lastIndex = candidates.findIndex((c) => c._id.toString() === lastIdStr);
      index = lastIndex >= 0 ? (lastIndex + 1) % candidates.length : 0;
    }
    const chosen = candidates[index]!;

    const filter: Record<string, unknown> = { _id: settings._id };
    if (lastId) {
      filter['leadAssignment.lastAssignedUserId'] = lastId;
    } else {
      filter.$or = [
        { 'leadAssignment.lastAssignedUserId': null },
        { 'leadAssignment.lastAssignedUserId': { $exists: false } },
      ];
    }

    const updated = await CompanySettingsModel.findOneAndUpdate(
      filter,
      { $set: { 'leadAssignment.lastAssignedUserId': chosen._id } },
      { new: true, session: session ?? undefined },
    );

    if (updated) {
      return chosen._id;
    }
  }

  throw new AppError({
    status: 503,
    code: 'ASSIGNMENT_BUSY',
    message: 'Lead assignment is busy. Please retry.',
  });
}

/** Only active salespeople flagged to receive leads may be assigned. */
export async function assertAssignableSalesperson(
  userId: string,
  session?: ClientSession,
): Promise<Types.ObjectId> {
  const user = await UserModel.findOne({
    _id: userId,
    role: 'salesperson',
    isActive: true,
    receivesLeads: true,
  })
    .session(session ?? null)
    .select({ _id: 1 });

  if (!user) {
    throw new AppError({
      status: 422,
      code: 'INVALID_ASSIGNEE',
      message: 'Assignee must be an active salesperson who receives leads.',
      details: [{ path: 'assignedTo', message: 'Invalid assignee' }],
    });
  }
  return user._id;
}
