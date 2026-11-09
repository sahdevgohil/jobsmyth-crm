import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/shared/PageHeader';
import { usePortalAuthStore } from '@/stores/portal-auth-store';

export function PortalHomePage(): React.ReactElement {
  const account = usePortalAuthStore((s) => s.account);
  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome${account ? `, ${account.firstName}` : ''}`}
        description="Read-only access to your proposals, projects, invoices, and shared documents."
      />
      <div className="grid gap-3 sm:grid-cols-2">
        {[
          { to: '/portal/proposals', label: 'Proposals' },
          { to: '/portal/projects', label: 'Projects' },
          { to: '/portal/invoices', label: 'Invoices' },
          { to: '/portal/documents', label: 'Documents' },
        ].map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="rounded-xl border border-border bg-card p-4 transition hover:border-brand"
          >
            <p className="font-medium text-brand">{item.label}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
