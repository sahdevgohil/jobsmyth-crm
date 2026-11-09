import { PageHeader } from '@/components/shared/PageHeader';
import { ErrorState, LoadingState } from '@/components/shared/StatePanel';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { useIntegrations } from '@/modules/operations/api';

const TONE: Record<string, 'neutral' | 'success' | 'warning' | 'danger' | 'info'> = {
  not_configured: 'neutral',
  configuration_required: 'warning',
  connected: 'success',
  syncing: 'info',
  error: 'danger',
  disconnected: 'neutral',
};

export function IntegrationsPage(): React.ReactElement {
  const q = useIntegrations();
  return (
    <div>
      <PageHeader
        title="Integrations"
        description="Status of external services. “Connected” is only shown after a live connection has been verified."
      />
      {q.isLoading ? <LoadingState /> : null}
      {q.isError ? <ErrorState message="Failed to load integration status." onRetry={() => void q.refetch()} /> : null}
      <div className="grid gap-3 md:grid-cols-2">
        {(q.data?.data ?? []).map((i) => (
          <section key={i.key} className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="font-semibold">{i.name}</h2>
                <p className="text-xs text-muted-foreground">{i.purpose}</p>
              </div>
              <StatusBadge status={i.status} tone={TONE[i.status]} />
            </div>
            <p className="mt-3 text-sm">{i.message}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              <span className="font-medium">Meanwhile:</span> {i.fallback}
            </p>
          </section>
        ))}
      </div>
    </div>
  );
}
