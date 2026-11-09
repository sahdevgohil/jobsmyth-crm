import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/services/http';
import { ApiError } from '@/types/api';

export const PRODUCT_FAMILIES = [
  ['shingle', 'Shingles'], ['starter', 'Starter'], ['ice_water', 'Ice and water'], ['underlayment', 'Synthetic underlayment'],
  ['hip_ridge', 'Hips and ridges'], ['valley', 'Valley'], ['drip_edge', 'Drip edge'], ['flashing', 'Flashing'], ['accessory', 'Accessories'],
] as const;

export type CatalogProductDto = { id: string; family: string; brand: string; name: string; packageUnit: string; coveragePerPackage: number; countKey: string | null; enabled: boolean; specConfirmed: boolean; sortOrder: number; notes: string; isDemo: boolean };

const KEY = ['solar', 'material-products'];
const jsonBody = (b: unknown): string => JSON.stringify(b);

function useProducts() {
  return useQuery({ queryKey: KEY, queryFn: () => apiFetch<{ data: CatalogProductDto[] }>('/measurements/solar/material-products').then((r) => r.data) });
}

function useProductMutations() {
  const qc = useQueryClient();
  const refresh = async (): Promise<void> => { await Promise.all([qc.invalidateQueries({ queryKey: KEY }), qc.invalidateQueries({ queryKey: ['ws'] })]); };
  return {
    create: useMutation({ mutationFn: (b: Record<string, unknown>) => apiFetch('/measurements/solar/material-products', { method: 'POST', body: jsonBody(b) }), onSuccess: refresh }),
    update: useMutation({ mutationFn: (v: { id: string; body: Record<string, unknown> }) => apiFetch(`/measurements/solar/material-products/${v.id}`, { method: 'PATCH', body: jsonBody(v.body) }), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: string) => apiFetch(`/measurements/solar/material-products/${id}`, { method: 'DELETE' }), onSuccess: refresh }),
  };
}

const EMPTY = { family: 'shingle', brand: '', name: '', packageUnit: 'bundle', coveragePerPackage: '' };

/** Administrators enter the real packaging of the products they buy. Nothing here is invented: rows without a confirmed specification print with an asterisk. */
export function MaterialCatalog(): React.ReactElement {
  const list = useProducts();
  const mut = useProductMutations();
  const [draft, setDraft] = useState<typeof EMPTY>(EMPTY);
  const [err, setErr] = useState<string | null>(null);
  const label = (f: string): string => PRODUCT_FAMILIES.find(([k]) => k === f)?.[1] ?? f;

  async function add(): Promise<void> {
    setErr(null);
    const coverage = Number(draft.coveragePerPackage);
    if (!draft.name.trim() || !draft.packageUnit.trim() || !(coverage > 0)) { setErr('Enter a product name, a package unit and a coverage above 0.'); return; }
    try {
      await mut.create.mutateAsync({ family: draft.family, brand: draft.brand.trim(), name: draft.name.trim(), packageUnit: draft.packageUnit.trim(), coveragePerPackage: coverage });
      setDraft(EMPTY);
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not add the product.'); }
  }
  async function patch(id: string, body: Record<string, unknown>): Promise<void> {
    setErr(null);
    try { await mut.update.mutateAsync({ id, body }); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not update the product.'); }
  }
  async function del(p: CatalogProductDto): Promise<void> {
    if (!window.confirm(`Delete ${[p.brand, p.name].filter(Boolean).join(' ')}?`)) return;
    setErr(null);
    try { await mut.remove.mutateAsync(p.id); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not delete the product.'); }
  }

  const products = list.data ?? [];
  return (
    <section aria-label="Material products" className="space-y-3 rounded-lg border border-border bg-card p-4">
      <h2 className="text-base font-semibold">Material products</h2>
      <p className="text-xs text-muted-foreground">Report material calculations use these products and their package coverage. Enter the specification from your supplier and tick “Spec confirmed”; unconfirmed rows are marked with an asterisk in reports. With no products in a family, reports show a generic placeholder row marked unconfirmed.</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] text-sm">
          <thead><tr className="text-left text-muted-foreground"><th className="py-1">Family</th><th>Brand</th><th>Product</th><th>Unit</th><th>Coverage per package</th><th>Enabled</th><th>Spec confirmed</th><th /></tr></thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id} className="border-t border-border/60">
                <td className="py-1">{label(p.family)}</td><td>{p.brand}</td><td>{p.name}{p.isDemo ? <span className="ml-1 rounded bg-warning/20 px-1 text-xs">demo</span> : null}</td><td>{p.packageUnit}</td>
                <td>{p.coveragePerPackage}</td>
                <td><input type="checkbox" aria-label={`Enable ${p.name}`} checked={p.enabled} onChange={(e) => void patch(p.id, { enabled: e.target.checked })} /></td>
                <td><input type="checkbox" aria-label={`Spec confirmed for ${p.name}`} checked={p.specConfirmed} onChange={(e) => void patch(p.id, { specConfirmed: e.target.checked })} /></td>
                <td className="text-right"><Button type="button" variant="outline" size="sm" aria-label={`Delete ${p.name}`} onClick={() => void del(p)}>Delete</Button></td>
              </tr>
            ))}
            {products.length === 0 ? <tr><td colSpan={8} className="py-2 text-muted-foreground">No products yet.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <div className="grid gap-2 sm:grid-cols-6">
        <select aria-label="Family" className="h-9 rounded-md border border-border bg-card px-2" value={draft.family} onChange={(e) => setDraft({ ...draft, family: e.target.value })}>{PRODUCT_FAMILIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <Input aria-label="Brand" placeholder="Brand" className="h-9" value={draft.brand} onChange={(e) => setDraft({ ...draft, brand: e.target.value })} />
        <Input aria-label="Product name" placeholder="Product name" className="h-9" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <Input aria-label="Package unit" placeholder="bundle, roll…" className="h-9" value={draft.packageUnit} onChange={(e) => setDraft({ ...draft, packageUnit: e.target.value })} />
        <Input aria-label="Coverage per package" type="number" min={0} step="any" placeholder="Coverage" className="h-9" value={draft.coveragePerPackage} onChange={(e) => setDraft({ ...draft, coveragePerPackage: e.target.value })} />
        <Button type="button" disabled={mut.create.isPending} onClick={() => void add()}>Add product</Button>
      </div>
      {err ? <p role="alert" className="text-sm text-danger">{err}</p> : null}
    </section>
  );
}
