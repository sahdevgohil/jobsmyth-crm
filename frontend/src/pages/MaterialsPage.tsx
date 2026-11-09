import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { FormField } from '@/components/shared/FormField';
import { ListPage } from '@/components/shared/ListPage';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { dollarsToCents, formatCents } from '@/lib/money';
import { useHasPermission } from '@/lib/permissions';
import { useCreateMaterial, useUpdateMaterial } from '@/modules/materials/api';
import { ApiError } from '@/types/api';

type Mat = { id: string; name: string; sku: string; unit: string; costCents: number; supplier: string; active: boolean };

function CreateMaterial({ onDone }: { onDone: () => void }): React.ReactElement {
  const create = useCreateMaterial();
  const [f, setF] = useState({ name: '', sku: '', unit: 'ea', cost: '0.00', supplier: '' });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((v) => ({ ...v, [k]: e.target.value }));
  return (
    <form
      className="mb-6 grid gap-3 rounded-lg border border-border bg-card p-4 shadow-sm sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        create.mutate(
          { name: f.name, sku: f.sku || undefined, unit: f.unit, costCents: dollarsToCents(f.cost), supplier: f.supplier || undefined },
          { onSuccess: onDone, onError: (er) => setError(er instanceof ApiError ? er.message : 'Could not create material.') },
        );
      }}
    >
      <div className="sm:col-span-2"><FormField label="Name" htmlFor="m-name"><Input id="m-name" value={f.name} onChange={set('name')} required /></FormField></div>
      <FormField label="SKU" htmlFor="m-sku"><Input id="m-sku" value={f.sku} onChange={set('sku')} /></FormField>
      <FormField label="Unit" htmlFor="m-unit"><Input id="m-unit" value={f.unit} onChange={set('unit')} /></FormField>
      <FormField label="Cost (USD)" htmlFor="m-cost"><Input id="m-cost" value={f.cost} onChange={set('cost')} /></FormField>
      <FormField label="Supplier" htmlFor="m-sup"><Input id="m-sup" value={f.supplier} onChange={set('supplier')} /></FormField>
      {error ? <p role="alert" className="text-sm text-danger sm:col-span-2">{error}</p> : null}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" disabled={create.isPending}>Add material</Button>
        <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

function ActiveToggle({ m }: { m: Mat }): React.ReactElement {
  const update = useUpdateMaterial(m.id);
  const qc = useQueryClient();
  return (
    <button
      type="button"
      className="text-xs text-brand hover:underline"
      disabled={update.isPending}
      onClick={() => update.mutate({ active: !m.active }, { onSuccess: () => void qc.invalidateQueries({ queryKey: ['materials'] }) })}
    >
      {m.active ? 'Deactivate' : 'Activate'}
    </button>
  );
}

export function MaterialsPage(): React.ReactElement {
  const [creating, setCreating] = useState(false);
  const canCreate = useHasPermission('materials:create');
  const canUpdate = useHasPermission('materials:update');
  return (
    <>
      {creating ? <CreateMaterial onDone={() => setCreating(false)} /> : null}
      <ListPage<Mat>
        title="Materials"
        description="Catalogue only, not a warehouse system. Costs are stored as integer cents."
        queryKey="materials"
        path="/materials"
        searchPlaceholder="Search name, SKU or supplier"
        filters={[{ key: 'active', label: 'Status', options: [{ value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }] }]}
        actions={canCreate && !creating ? <Button onClick={() => setCreating(true)}>Add material</Button> : null}
        emptyTitle="No materials"
        emptyHint="Add catalogue items used on estimates and projects."
        columns={[
          { key: 'n', header: 'Material', render: (m) => <span>{m.name}<span className="block text-xs font-normal text-muted-foreground">{m.sku || 'No SKU'}</span></span> },
          { key: 'u', header: 'Unit', render: (m) => m.unit, hideOnMobile: true },
          { key: 's', header: 'Supplier', render: (m) => m.supplier || '—', hideOnMobile: true },
          { key: 'c', header: 'Unit cost', render: (m) => formatCents(m.costCents), align: 'right' },
          { key: 'a', header: 'Status', render: (m) => <span className="flex items-center gap-2"><StatusBadge status={m.active ? 'active' : 'inactive'} />{canUpdate ? <ActiveToggle m={m} /> : null}</span> },
        ]}
      />
    </>
  );
}
