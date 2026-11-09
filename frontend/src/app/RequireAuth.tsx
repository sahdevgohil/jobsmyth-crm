import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth-store';

export function RequireAuth(): React.ReactElement {
  const accessToken = useAuthStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);
  const bootstrapped = useAuthStore((s) => s.bootstrapped);
  const offline = useAuthStore((s) => s.offline);
  const location = useLocation();

  if (!bootstrapped) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading session…
      </div>
    );
  }

  if (offline && user) {
    // Offline session: only field mode works (it reads from this device). Everything else needs the server.
    if (!location.pathname.startsWith('/app/field')) return <Navigate to="/app/field" replace />;
    return <Outlet />;
  }

  if (!accessToken || !user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (user.mustChangePassword && location.pathname !== '/app/change-password') {
    return <Navigate to="/app/change-password" replace />;
  }

  return <Outlet />;
}
