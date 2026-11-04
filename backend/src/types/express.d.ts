import type { Permission, Role } from '../config/permissions.js';

export type AuthPrincipal = {
  principalType: 'user';
  userId: string;
  role: Role;
  email: string;
  permissions: Permission[];
  mustChangePassword: boolean;
};

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      auth?: AuthPrincipal;
      validated?: {
        body?: unknown;
        query?: unknown;
        params?: unknown;
      };
    }
  }
}

export {};
