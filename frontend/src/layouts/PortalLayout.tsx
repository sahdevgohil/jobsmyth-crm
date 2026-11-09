import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { BrandLogo } from '@/components/shared/BrandLogo';
import { Button } from '@/components/ui/button';
import { portalLogoutRequest } from '@/modules/portal/api';
import { usePortalAuthStore } from '@/stores/portal-auth-store';
import { cn } from '@/lib/cn';

const linkClass = ({ isActive }: { isActive: boolean }): string =>
  cn(
    'rounded-md px-3 py-2 text-sm font-medium transition-colors',
    isActive ? 'bg-brand text-primary-foreground' : 'text-foreground hover:bg-accent',
  );

export function PortalLayout(): React.ReactElement {
  const account = usePortalAuthStore((s) => s.account);
  const clearSession = usePortalAuthStore((s) => s.clearSession);
  const navigate = useNavigate();

  async function onLogout(): Promise<void> {
    try {
      await portalLogoutRequest();
    } finally {
      clearSession();
      void navigate('/portal/login');
    }
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-border border-t-4 border-t-brand bg-card">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <BrandLogo height={52} />
            <div className="border-l border-border pl-3">
              <p className="text-sm font-semibold text-primary">Customer Portal</p>
              <p className="text-xs text-muted-foreground">
                {account ? `${account.firstName} ${account.lastName}` : null}
              </p>
            </div>
          </div>
          <nav className="flex flex-wrap gap-1">
            <NavLink to="/portal" end className={linkClass}>
              Home
            </NavLink>
            <NavLink to="/portal/proposals" className={linkClass}>
              Proposals
            </NavLink>
            <NavLink to="/portal/projects" className={linkClass}>
              Projects
            </NavLink>
            <NavLink to="/portal/invoices" className={linkClass}>
              Invoices
            </NavLink>
            <NavLink to="/portal/documents" className={linkClass}>
              Documents
            </NavLink>
            <NavLink to="/portal/change-password" className={linkClass}>
              Password
            </NavLink>
          </nav>
          <Button variant="outline" size="sm" onClick={() => void onLogout()}>
            Sign out
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
