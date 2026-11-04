import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useHasPermission } from '@/lib/permissions';
import { logoutRequest } from '@/modules/auth/api';
import { useAuthStore } from '@/stores/auth-store';
import { cn } from '@/lib/cn';

const linkClass = ({ isActive }: { isActive: boolean }): string =>
  cn(
    'rounded-md px-3 py-2 text-sm font-medium transition-colors',
    isActive ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-accent',
  );

export function AppLayout(): React.ReactElement {
  const user = useAuthStore((s) => s.user);
  const clearSession = useAuthStore((s) => s.clearSession);
  const navigate = useNavigate();
  const canManageUsers = useHasPermission('users:manage');
  const canUpdateSettings = useHasPermission('settings:update');
  const canReadAudit = useHasPermission('audit:read');

  async function onLogout(): Promise<void> {
    try {
      await logoutRequest();
    } finally {
      clearSession();
      void navigate('/login');
    }
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-card/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-lg font-semibold text-primary">Legacy Roofing CRM</p>
            <p className="text-xs text-muted-foreground">
              {user ? `${user.firstName} ${user.lastName} · ${user.role}` : null}
            </p>
          </div>
          <nav className="flex flex-wrap gap-1">
            <NavLink to="/app" end className={linkClass}>
              Home
            </NavLink>
            {canManageUsers ? (
              <NavLink to="/app/users" className={linkClass}>
                Users
              </NavLink>
            ) : null}
            <NavLink to="/app/settings" className={linkClass}>
              Settings
            </NavLink>
            {canUpdateSettings ? (
              <NavLink to="/app/lookups" className={linkClass}>
                Lookups
              </NavLink>
            ) : null}
            {canReadAudit ? (
              <NavLink to="/app/audit" className={linkClass}>
                Audit
              </NavLink>
            ) : null}
            <NavLink to="/app/change-password" className={linkClass}>
              Password
            </NavLink>
          </nav>
          <Button variant="outline" size="sm" onClick={() => void onLogout()}>
            Sign out
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
