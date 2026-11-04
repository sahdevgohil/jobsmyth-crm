import mongoose from 'mongoose';
import type { Role } from '../../config/permissions.js';
import { recordAudit } from '../../services/audit.js';
import { AppError } from '../../utils/errors.js';
import { paginationMeta, skipLimit } from '../../utils/pagination.js';
import {
  createInviteToken,
  createPasswordHash,
  revokeAllUserSessions,
} from '../auth/auth.service.js';
import { toUserDto } from './user.mapper.js';
import { UserModel } from './user.model.js';
import type { UserDto } from './user.types.js';

export type CreateUserInput = {
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  role: Role;
  temporaryPassword: string;
  receivesLeads?: boolean;
  actorId: string;
  requestId?: string;
  ip?: string;
};

export type UpdateUserInput = {
  id: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  role?: Role;
  receivesLeads?: boolean;
  temporaryPassword?: string;
  actorId: string;
  requestId?: string;
  ip?: string;
};

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: number }).code === 11000
  );
}

export async function listUsers(input: {
  page: number;
  pageSize: number;
  role?: Role;
  isActive?: boolean;
}): Promise<{ data: UserDto[]; meta: { page: number; pageSize: number; total: number } }> {
  const filter: Record<string, unknown> = {};
  if (input.role) {
    filter.role = input.role;
  }
  if (input.isActive !== undefined) {
    filter.isActive = input.isActive;
  }
  const { skip, limit } = skipLimit(input.page, input.pageSize);
  const [total, users] = await Promise.all([
    UserModel.countDocuments(filter),
    UserModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
  ]);
  return {
    data: users.map(toUserDto),
    meta: paginationMeta(total, input.page, input.pageSize),
  };
}

export async function getUserById(id: string): Promise<UserDto> {
  if (!mongoose.isValidObjectId(id)) {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'User not found.' });
  }
  const user = await UserModel.findById(id);
  if (!user) {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'User not found.' });
  }
  return toUserDto(user);
}

export async function createUser(
  input: CreateUserInput,
): Promise<{ user: UserDto; inviteToken: string }> {
  const passwordHash = await createPasswordHash(input.temporaryPassword);
  try {
    const user = await UserModel.create({
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
      role: input.role,
      receivesLeads: input.receivesLeads ?? false,
      isActive: true,
      mustChangePassword: true,
      passwordHash,
    });

    const inviteToken = await createInviteToken(user._id);

    await recordAudit({
      actorType: 'user',
      actorId: input.actorId,
      action: 'user.created',
      entityType: 'user',
      entityId: user._id.toString(),
      changes: { email: user.email, role: user.role },
      requestId: input.requestId,
      ip: input.ip,
    });

    return { user: toUserDto(user), inviteToken };
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new AppError({
        status: 409,
        code: 'EMAIL_IN_USE',
        message: 'A user with this email already exists.',
      });
    }
    throw error;
  }
}

export async function updateUser(input: UpdateUserInput): Promise<UserDto> {
  if (!mongoose.isValidObjectId(input.id)) {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'User not found.' });
  }
  const user = await UserModel.findById(input.id);
  if (!user) {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'User not found.' });
  }

  const before = {
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    role: user.role,
    receivesLeads: user.receivesLeads,
  };

  if (input.firstName !== undefined) user.firstName = input.firstName;
  if (input.lastName !== undefined) user.lastName = input.lastName;
  if (input.phone !== undefined) user.phone = input.phone;
  if (input.receivesLeads !== undefined) user.receivesLeads = input.receivesLeads;

  const roleChanged = input.role !== undefined && input.role !== user.role;
  if (input.role !== undefined) {
    user.role = input.role;
  }

  if (input.temporaryPassword) {
    user.passwordHash = await createPasswordHash(input.temporaryPassword);
    user.mustChangePassword = true;
  }

  await user.save();

  if (roleChanged || input.temporaryPassword) {
    await revokeAllUserSessions(user._id.toString());
  }

  await recordAudit({
    actorType: 'user',
    actorId: input.actorId,
    action: 'user.updated',
    entityType: 'user',
    entityId: user._id.toString(),
    changes: { before, after: {
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      role: user.role,
      receivesLeads: user.receivesLeads,
      passwordReset: Boolean(input.temporaryPassword),
    } },
    requestId: input.requestId,
    ip: input.ip,
  });

  return toUserDto(user);
}

export async function deactivateUser(input: {
  id: string;
  actorId: string;
  requestId?: string;
  ip?: string;
}): Promise<UserDto> {
  if (!mongoose.isValidObjectId(input.id)) {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'User not found.' });
  }
  if (input.id === input.actorId) {
    throw new AppError({
      status: 422,
      code: 'CANNOT_DEACTIVATE_SELF',
      message: 'You cannot deactivate your own account.',
    });
  }

  const user = await UserModel.findById(input.id);
  if (!user) {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'User not found.' });
  }

  user.isActive = false;
  await user.save();
  await revokeAllUserSessions(user._id.toString());

  await recordAudit({
    actorType: 'user',
    actorId: input.actorId,
    action: 'user.deactivated',
    entityType: 'user',
    entityId: user._id.toString(),
    requestId: input.requestId,
    ip: input.ip,
  });

  return toUserDto(user);
}
