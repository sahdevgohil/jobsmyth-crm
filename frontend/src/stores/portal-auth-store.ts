import { create } from 'zustand';

export type PortalAccount = {
  id: string;
  customerId: string;
  email: string;
  firstName: string;
  lastName: string;
  mustChangePassword: boolean;
};

type PortalAuthState = {
  accessToken: string | null;
  account: PortalAccount | null;
  bootstrapped: boolean;
  setSession: (accessToken: string, account: PortalAccount) => void;
  setAccessToken: (accessToken: string) => void;
  setAccount: (account: PortalAccount) => void;
  clearSession: () => void;
  setBootstrapped: (value: boolean) => void;
};

export const usePortalAuthStore = create<PortalAuthState>((set) => ({
  accessToken: null,
  account: null,
  bootstrapped: false,
  setSession: (accessToken, account) => set({ accessToken, account }),
  setAccessToken: (accessToken) => set({ accessToken }),
  setAccount: (account) => set({ account }),
  clearSession: () => set({ accessToken: null, account: null }),
  setBootstrapped: (bootstrapped) => set({ bootstrapped }),
}));
