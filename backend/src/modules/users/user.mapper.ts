import { permissionsForRole, type Role } from '../../config/permissions.js';
import type { UserDocument } from './user.model.js';
import type { PublicUserDto, UserDto } from './user.types.js';

export function toUserDto(user: UserDocument): UserDto {
  return {
    id: user._id.toString(),
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone ?? undefined,
    role: user.role as Role,
    isActive: user.isActive,
    receivesLeads: user.receivesLeads,
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt?.toISOString(),
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export function toPublicUserDto(user: UserDocument): PublicUserDto {
  const role = user.role as Role;
  return {
    id: user._id.toString(),
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role,
    mustChangePassword: user.mustChangePassword,
    permissions: permissionsForRole(role),
  };
}
