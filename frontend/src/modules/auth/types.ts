import type { AuthUser } from '@/stores/auth-store';

export type LoginResponse = {
  data: {
    accessToken: string;
    user: AuthUser;
  };
};

export type MeResponse = {
  data: AuthUser;
};
