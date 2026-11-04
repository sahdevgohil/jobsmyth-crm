import { useEffect, type ReactNode } from 'react';
import { bootstrapSession, meRequest } from '@/modules/auth/api';
import { useAuthStore } from '@/stores/auth-store';

export function SessionBootstrap({ children }: { children: ReactNode }): React.ReactElement {
  const setSession = useAuthStore((s) => s.setSession);
  const clearSession = useAuthStore((s) => s.clearSession);
  const setBootstrapped = useAuthStore((s) => s.setBootstrapped);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const token = await bootstrapSession();
        if (!token) {
          if (!cancelled) {
            clearSession();
            setBootstrapped(true);
          }
          return;
        }
        useAuthStore.getState().setAccessToken(token);
        const me = await meRequest();
        if (!cancelled) {
          setSession(token, me.data);
          setBootstrapped(true);
        }
      } catch {
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
