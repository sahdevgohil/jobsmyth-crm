import { create } from 'zustand';

export type AuthUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'admin' | 'salesperson';
  mustChangePassword: boolean;
  permissions: string[];
};

const PROFILE_KEY = 'legacy.offlineProfile';

/** Non-secret profile (no tokens) so field mode can open with no connection. Removed on sign-out. */
function rememberProfile(user: AuthUser): void {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify({ ...user, mustChangePassword: false }));
  } catch {
    /* storage unavailable: offline start simply will not be offered */
  }
}
export function readRememberedProfile(): AuthUser | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}
export function forgetRememberedProfile(): void {
  try {
    localStorage.removeItem(PROFILE_KEY);
  } catch {
    /* ignore */
  }
}

type AuthState = {
  accessToken: string | null;
  user: AuthUser | null;
  bootstrapped: boolean;
  /** Signed in from a remembered profile while the server is unreachable: field mode only, no API token. */
  offline: boolean;
  setOfflineSession: (user: AuthUser) => void;
  setSession: (accessToken: string, user: AuthUser) => void;
  setAccessToken: (accessToken: string) => void;
  setUser: (user: AuthUser) => void;
  clearSession: () => void;
  setBootstrapped: (value: boolean) => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  bootstrapped: false,
  offline: false,
  setOfflineSession: (user) => set({ user, accessToken: null, offline: true }),
  setSession: (accessToken, user) => {
    rememberProfile(user);
    set({ accessToken, user, offline: false });
  },
  setAccessToken: (accessToken) => set({ accessToken, offline: false }),
  setUser: (user) => set({ user }),
  clearSession: () => set({ accessToken: null, user: null, offline: false }),
  setBootstrapped: (bootstrapped) => set({ bootstrapped }),
}));
