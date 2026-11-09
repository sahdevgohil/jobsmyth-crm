import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '@/components/shared/PageHeader';
import { ErrorState, LoadingState } from '@/components/shared/StatePanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useHasPermission } from '@/lib/permissions';
import { FilePanel } from '@/components/shared/FilePanel';
import {
  openInspectionReport,
  useCompleteInspection,
  useInspection,
  useUpdateInspection,
} from '@/modules/inspections/api';
import { useAuthStore } from '@/stores/auth-store';
import { ApiError } from '@/types/api';

export function InspectionDetailPage(): React.ReactElement {
  const { id = '' } = useParams();
  const token = useAuthStore((s) => s.accessToken);
  const canCreateMeasurement = useHasPermission('measurements:create');
  const canCreateEstimate = useHasPermission('estimates:create');
  const inspection = useInspection(id);
  const update = useUpdateInspection(id);
  const complete = useCompleteInspection(id);
  const canUploadFiles = useHasPermission('files:create');
  const [form, setForm] = useState({
    roofCondition: '',
    findings: '',
    damageObservations: '',
    recommendations: '',
    notes: '',
    totalAreaSqFt: '',
    pitch: '',
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!inspection.data?.data) return;
    const row = inspection.data.data;
    setForm({
      roofCondition: row.roofCondition,
      findings: row.findings,
      damageObservations: row.damageObservations,
      recommendations: row.recommendations,
      notes: row.notes,
      totalAreaSqFt: row.measurements.totalAreaSqFt?.toString() ?? '',
      pitch: row.measurements.pitch,
    });
  }, [inspection.data?.data]);

  if (inspection.isLoading) return <LoadingState />;
  if (inspection.isError || !inspection.data) {
    return (
      <ErrorState
        message={inspection.error instanceof ApiError ? inspection.error.message : 'Not found.'}
        onRetry={() => void inspection.refetch()}
      />
    );
  }
  const row = inspection.data.data;
  const editable = row.status === 'draft' || row.status === 'in_progress';

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Inspection · ${row.status}`}
        description={new Date(row.inspectionDate).toLocaleString()}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link to="/app/inspections">Back</Link>
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                void openInspectionReport(id, token).catch((err) =>
                  setError(err instanceof Error ? err.message : 'Report failed'),
                )
              }
            >
              Printable report
            </Button>
            {canCreateMeasurement ? (
              <Button asChild variant="outline">
                <Link
                  to={`/app/measurements/new?propertyId=${row.propertyId}&inspectionId=${row.id}`}
                >
                  Add measurement
                </Link>
              </Button>
            ) : null}
            {canCreateEstimate ? (
              <Button asChild variant="outline">
                <Link
                  to={`/app/estimates/new?customerId=${row.customerId}&propertyId=${row.propertyId}&inspectionId=${row.id}`}
                >
                  New estimate
                </Link>
              </Button>
            ) : null}
          </div>
        }
      />

      <p className="text-sm">
        <Link className="text-brand underline" to={`/app/customers/${row.customerId}`}>
          Customer
        </Link>
        {' · '}
        <Link className="text-brand underline" to={`/app/properties/${row.propertyId}`}>
          Property
        </Link>
      </p>

      <form
        className="space-y-3 rounded-xl border border-border bg-card p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!editable) return;
          setError(null);
          void update
            .mutateAsync({
              roofCondition: form.roofCondition,
              findings: form.findings,
              damageObservations: form.damageObservations,
              recommendations: form.recommendations,
              notes: form.notes,
              measurements: {
                totalAreaSqFt: form.totalAreaSqFt ? Number(form.totalAreaSqFt) : undefined,
                pitch: form.pitch || undefined,
              },
              status: row.status === 'draft' ? 'in_progress' : undefined,
            })
            .then(() => setMsg('Saved.'))
            .catch((err) => setError(err instanceof ApiError ? err.message : 'Save failed.'));
        }}
      >
        {(
          [
            ['roofCondition', 'Roof condition'],
            ['findings', 'Findings'],
            ['damageObservations', 'Damage observations'],
            ['recommendations', 'Recommendations'],
            ['notes', 'Notes'],
          ] as const
        ).map(([key, label]) => (
          <div key={key} className="space-y-2">
            <Label htmlFor={key}>{label}</Label>
            <textarea
              id={key}
              disabled={!editable}
              className="min-h-16 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-60"
              value={form[key]}
              onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
            />
          </div>
        ))}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="area">Total area (sq ft)</Label>
            <Input
              id="area"
              disabled={!editable}
              value={form.totalAreaSqFt}
              onChange={(e) => setForm((f) => ({ ...f, totalAreaSqFt: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pitch">Pitch</Label>
            <Input
              id="pitch"
              disabled={!editable}
              value={form.pitch}
              onChange={(e) => setForm((f) => ({ ...f, pitch: e.target.value }))}
            />
          </div>
        </div>
        {editable ? (
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={update.isPending}>
              Save
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={complete.isPending}
              onClick={() =>
                void complete
                  .mutateAsync()
                  .then(() => setMsg('Marked completed.'))
                  .catch((err) =>
                    setError(err instanceof ApiError ? err.message : 'Complete failed.'),
                  )
              }
            >
              Mark completed
            </Button>
          </div>
        ) : null}
      </form>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Photos &amp; documents</h2>
        {!editable ? <p className="text-xs text-muted-foreground">Uploads are locked after the inspection is completed.</p> : null}
        <FilePanel link={{ inspectionId: id }} category="photo" canUpload={editable && canUploadFiles} />
      </section>

      {msg ? <p className="text-sm text-brand">{msg}</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
