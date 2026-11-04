import { useState } from 'react';
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/StatePanel';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCreateLookup, useLookups, useUpdateLookup } from '@/modules/settings/api';
import { ApiError } from '@/types/api';

const LOOKUP_TYPES = [
  'lead_source',
  'lost_reason',
  'property_type',
  'appointment_type',
  'photo_category',
  'slope_tag',
  'damage_tag',
  'material_category',
  'project_category',
  'warranty_type',
] as const;

export function LookupsPage(): React.ReactElement {
  const [type, setType] = useState<(typeof LOOKUP_TYPES)[number]>('lead_source');
  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const query = useLookups(type);
  const createLookup = useCreateLookup(type);
  const updateLookup = useUpdateLookup(type);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Lookup lists"
        description="Configurable lists managed by Admin. Values in use are deactivated, never deleted."
      />

      <div className="max-w-xs space-y-2">
        <Label htmlFor="type">Lookup type</Label>
        <select
          id="type"
          className="flex h-10 w-full rounded-md border border-border bg-card px-3 text-sm"
          value={type}
          onChange={(e) => setType(e.target.value as (typeof LOOKUP_TYPES)[number])}
        >
          {LOOKUP_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      <form
        className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          void createLookup.mutateAsync({ key, label }).then(() => {
            setKey('');
            setLabel('');
          });
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="key">Key</Label>
          <Input id="key" value={key} onChange={(e) => setKey(e.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="label">Label</Label>
          <Input id="label" value={label} onChange={(e) => setLabel(e.target.value)} required />
        </div>
        <Button type="submit">Add</Button>
      </form>

      {query.isLoading ? <LoadingState /> : null}
      {query.isError ? (
        <ErrorState
          message={query.error instanceof ApiError ? query.error.message : 'Failed to load lookups.'}
          onRetry={() => void query.refetch()}
        />
      ) : null}
      {query.data && query.data.data.length === 0 ? (
        <EmptyState title="No values" description="Add the first lookup value for this type." />
      ) : null}
      {query.data && query.data.data.length > 0 ? (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {query.data.data.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <div>
                <p className="font-medium">{item.label}</p>
                <p className="text-muted-foreground">
                  {item.key} · {item.isActive ? 'active' : 'inactive'}
                </p>
              </div>
              {item.isActive ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void updateLookup.mutateAsync({ id: item.id, isActive: false })}
                >
                  Deactivate
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void updateLookup.mutateAsync({ id: item.id, isActive: true })}
                >
                  Reactivate
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
