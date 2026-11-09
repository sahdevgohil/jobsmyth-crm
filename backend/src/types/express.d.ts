import type { Permission, Role } from '../config/permissions.js';

export type AuthPrincipal = {
  principalType: 'user';
  userId: string;
  /** Company the user belongs to; never taken from the client. */
  companyId: string;
  role: Role;
  email: string;
  permissions: Permission[];
  mustChangePassword: boolean;
};

export type PortalPrincipal = {
  principalType: 'customer';
  accountId: string;
  customerId: string;
  email: string;
  mustChangePassword: boolean;
};

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      auth?: AuthPrincipal;
      portal?: PortalPrincipal;
      validated?: {
        body?: unknown;
        query?: unknown;
        params?: unknown;
      };
    }
  }
}

export {};
