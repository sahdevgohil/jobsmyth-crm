export type User = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  role: 'admin' | 'salesperson';
  isActive: boolean;
  receivesLeads: boolean;
  mustChangePassword: boolean;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type UsersListResponse = {
  data: User[];
  meta: { page: number; pageSize: number; total: number };
};
