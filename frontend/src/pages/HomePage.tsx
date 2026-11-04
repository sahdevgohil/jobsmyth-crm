import { PageHeader } from '@/components/shared/PageHeader';
import { useAuthStore } from '@/stores/auth-store';

export function HomePage(): React.ReactElement {
  const user = useAuthStore((s) => s.user);
  return (
    <div>
      <PageHeader
        title={`Welcome, ${user?.firstName ?? 'there'}`}
        description="Phase 1 foundation is active. Lead, customer, and field modules arrive in later phases."
      />
      <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
        <p>
          Signed in as <span className="font-medium text-foreground">{user?.email}</span> with role{' '}
          <span className="font-medium text-foreground">{user?.role}</span>.
        </p>
        <p className="mt-2">
          Use the navigation to manage users (Admin), company settings, lookups, and the audit log.
        </p>
      </div>
    </div>
  );
}
