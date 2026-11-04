import { useEffect, useState } from 'react';
import { ErrorState, LoadingState } from '@/components/shared/StatePanel';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useHasPermission } from '@/lib/permissions';
import { useCompanySettings, useUpdateCompanySettings } from '@/modules/settings/api';
import { ApiError } from '@/types/api';

export function SettingsPage(): React.ReactElement {
  const canUpdate = useHasPermission('settings:update');
  const query = useCompanySettings();
  const update = useUpdateCompanySettings();
  const [form, setForm] = useState({
    legalName: '',
    displayName: '',
    phone: '',
    email: '',
    website: '',
    licenseText: '',
    timezone: 'America/Chicago',
    defaultWasteBp: 1000,
    defaultMarginBp: 4000,
    estimateExpiryDays: 30,
  });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (query.data?.data) {
      const d = query.data.data;
      setForm({
        legalName: d.legalName,
        displayName: d.displayName,
        phone: d.phone,
        email: d.email,
        website: d.website,
        licenseText: d.licenseText,
        timezone: d.timezone,
        defaultWasteBp: d.defaultWasteBp,
        defaultMarginBp: d.defaultMarginBp,
        estimateExpiryDays: d.estimateExpiryDays,
      });
    }
  }, [query.data]);

  async function onSave(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setMessage(null);
    try {
      await update.mutateAsync(form);
      setMessage('Settings saved.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to save settings.');
    }
  }

  if (query.isLoading) {
    return <LoadingState />;
  }
  if (query.isError) {
    return (
      <ErrorState
        message={query.error instanceof ApiError ? query.error.message : 'Failed to load settings.'}
        onRetry={() => void query.refetch()}
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="Company settings"
        description="Branding and defaults used across the CRM. Values come from the database, not hardcoded UI constants."
      />
      <form
        className="grid max-w-2xl gap-4 rounded-xl border border-border bg-card p-6 sm:grid-cols-2"
        onSubmit={(e) => void onSave(e)}
      >
        {(
          [
            ['legalName', 'Legal name'],
            ['displayName', 'Display name'],
            ['phone', 'Phone'],
            ['email', 'Email'],
            ['website', 'Website'],
            ['timezone', 'Timezone'],
          ] as const
        ).map(([key, label]) => (
          <div key={key} className="space-y-2">
            <Label htmlFor={key}>{label}</Label>
            <Input
              id={key}
              value={form[key]}
              disabled={!canUpdate}
              onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))}
            />
          </div>
        ))}
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="licenseText">License / registration text</Label>
          <Input
            id="licenseText"
            value={form.licenseText}
            disabled={!canUpdate}
            onChange={(e) => setForm((prev) => ({ ...prev, licenseText: e.target.value }))}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="defaultWasteBp">Default waste (basis points)</Label>
          <Input
            id="defaultWasteBp"
            type="number"
            value={form.defaultWasteBp}
            disabled={!canUpdate}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, defaultWasteBp: Number(e.target.value) }))
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="defaultMarginBp">Default margin (basis points)</Label>
          <Input
            id="defaultMarginBp"
            type="number"
            value={form.defaultMarginBp}
            disabled={!canUpdate}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, defaultMarginBp: Number(e.target.value) }))
            }
          />
        </div>
        {message ? <p className="text-sm text-primary sm:col-span-2">{message}</p> : null}
        {error ? <p className="text-sm text-destructive sm:col-span-2">{error}</p> : null}
        {canUpdate ? (
          <div className="sm:col-span-2">
            <Button type="submit" disabled={update.isPending}>
              Save settings
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground sm:col-span-2">View only for your role.</p>
        )}
      </form>
    </div>
  );
}
