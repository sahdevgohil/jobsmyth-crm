import { useEffect, type ReactNode } from 'react';
import { bootstrapPortalSession, portalMeRequest } from '@/modules/portal/api';
import { usePortalAuthStore } from '@/stores/portal-auth-store';

export function PortalSessionBootstrap({
  children,
}: {
  children: ReactNode;
}): React.ReactElement {
  const setSession = usePortalAuthStore((s) => s.setSession);
  const clearSession = usePortalAuthStore((s) => s.clearSession);
  const setBootstrapped = usePortalAuthStore((s) => s.setBootstrapped);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const token = await bootstrapPortalSession();
        if (!token) {
          if (!cancelled) {
            clearSession();
            setBootstrapped(true);
          }
          return;
        }
        usePortalAuthStore.getState().setAccessToken(token);
        const me = await portalMeRequest();
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
