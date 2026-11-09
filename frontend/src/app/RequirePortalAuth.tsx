import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { usePortalAuthStore } from '@/stores/portal-auth-store';

export function RequirePortalAuth(): React.ReactElement {
  const accessToken = usePortalAuthStore((s) => s.accessToken);
  const account = usePortalAuthStore((s) => s.account);
  const bootstrapped = usePortalAuthStore((s) => s.bootstrapped);
  const location = useLocation();

  if (!bootstrapped) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading portal session…
      </div>
    );
  }

  if (!accessToken || !account) {
    return <Navigate to="/portal/login" replace state={{ from: location.pathname }} />;
  }

  if (account.mustChangePassword && location.pathname !== '/portal/change-password') {
    return <Navigate to="/portal/change-password" replace />;
  }

  return <Outlet />;
}
