import { useEffect, type ReactNode } from 'react';
import * as authApi from '@/modules/auth/api';
import { readRememberedProfile, useAuthStore } from '@/stores/auth-store';

export function SessionBootstrap({ children }: { children: ReactNode }): React.ReactElement {
  const setSession = useAuthStore((s) => s.setSession);
  const clearSession = useAuthStore((s) => s.clearSession);
  const setBootstrapped = useAuthStore((s) => s.setBootstrapped);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const token = await authApi.bootstrapSession();
        if (!token) {
          const remembered = authApi.lastBootstrapWasNetworkFailure ? readRememberedProfile() : null;
          if (!cancelled && remembered) {
            useAuthStore.getState().setOfflineSession(remembered);
            setBootstrapped(true);
            return;
          }
          if (!cancelled) {
            clearSession();
            setBootstrapped(true);
          }
          return;
        }
        useAuthStore.getState().setAccessToken(token);
        const me = await authApi.meRequest();
        if (!cancelled) {
          setSession(token, me.data);
          setBootstrapped(true);
        }
      } catch {
        const remembered = authApi.lastBootstrapWasNetworkFailure ? readRememberedProfile() : null;
        if (!cancelled && remembered) {
          useAuthStore.getState().setOfflineSession(remembered);
          setBootstrapped(true);
          return;
        }
        if (!cancelled) {
          clearSession();
          setBootstrapped(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clearSession, setBootstrapped, setSession]);

  return <>{children}</>;
}
