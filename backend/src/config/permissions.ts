export const ROLES = ['admin', 'salesperson'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'users:manage',
  'users:read',
  'settings:read',
  'settings:update',
  'audit:read',
  'auth:change_password',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const rolePermissions: Record<Role, readonly Permission[]> = {
  admin: [
    'users:manage',
    'users:read',
    'settings:read',
    'settings:update',
    'audit:read',
    'auth:change_password',
  ],
  salesperson: ['settings:read', 'auth:change_password'],
};

export function permissionsForRole(role: Role): Permission[] {
  return [...rolePermissions[role]];
}

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return rolePermissions[role].includes(permission);
}
