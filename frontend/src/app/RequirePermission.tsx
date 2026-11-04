import { Navigate, Outlet } from 'react-router-dom';
import { useHasPermission } from '@/lib/permissions';

export function RequirePermission({
  permission,
}: {
  permission: string;
}): React.ReactElement {
  const allowed = useHasPermission(permission);
  if (!allowed) {
    return <Navigate to="/app" replace />;
  }
  return <Outlet />;
}
