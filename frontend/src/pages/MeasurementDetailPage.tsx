import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '@/components/shared/PageHeader';
import { ErrorState, LoadingState } from '@/components/shared/StatePanel';
import { Button } from '@/components/ui/button';
import { useHasPermission } from '@/lib/permissions';
import { useMeasurement } from '@/modules/measurements/api';
import { Workspace } from '@/modules/measurements/Workspace';
import { ApiError } from '@/types/api';

export function MeasurementDetailPage(): React.ReactElement {
  const { id = '' } = useParams();
  const query = useMeasurement(id);
  const canCreateEstimate = useHasPermission('estimates:create');

  if (query.isLoading) return <LoadingState />;
  if (query.isError || !query.data) {
    return (
      <ErrorState
        message={query.error instanceof ApiError ? query.error.message : 'Not found.'}
        onRetry={() => void query.refetch()}
      />
    );
  }
  const m = query.data.data;
  const rows: Array<[string, string]> = [
    ['Source', m.source],
    ['Provider', `${m.provider} (${m.providerStatus.replace('_', ' ')})`],
    ['Date', new Date(m.measurementDate).toLocaleDateString()],
    ['Total area', m.totalArea !== null ? `${m.totalArea} ${m.units.replace('_', ' ')}` : '—'],
    ['Facets', m.facets !== null ? String(m.facets) : '—'],
    ['Pitch', m.pitch || '—'],
    ['Ridge (ft)', m.ridge !== null ? String(m.ridge) : '—'],
    ['Hip (ft)', m.hip !== null ? String(m.hip) : '—'],
    ['Valley (ft)', m.valley !== null ? String(m.valley) : '—'],
    ['Eave (ft)', m.eave !== null ? String(m.eave) : '—'],
    ['Rake (ft)', m.rake !== null ? String(m.rake) : '—'],
    ['Imported file', m.importedFilename ?? '—'],
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Measurement"
        description={m.solar ? (m.solar.isDemo ? "Demonstration measurement (sample data)." : "Roof data from Google Solar, with CRM calculations. Verify in the field before ordering materials.") : "Measurements are entered manually and are approximate."}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link to="/app/measurements">Back</Link>
            </Button>
            {canCreateEstimate && !m.solar ? (
              <Button asChild>
                <Link
                  to={`/app/estimates/new?customerId=${m.customerId}&propertyId=${m.propertyId}&measurementId=${m.id}${
                    m.inspectionId ? `&inspectionId=${m.inspectionId}` : ''
                  }`}
                >
                  New estimate
                </Link>
              </Button>
            ) : null}
          </div>
        }
      />
      {!m.solar ? (
      <dl className="grid gap-2 rounded-xl border border-border bg-card p-4 text-sm sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {m.solar ? <Workspace m={m} /> : null}
      {m.notes ? (
        <p className="whitespace-pre-wrap rounded-xl border border-border bg-card p-4 text-sm">
          {m.notes}
        </p>
      ) : null}
    </div>
  );
}
