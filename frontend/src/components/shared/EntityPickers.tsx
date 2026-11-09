import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { FormField, selectClass } from '@/components/shared/FormField';
import { SearchInput } from '@/components/shared/FilterBar';
import { Button } from '@/components/ui/button';
import { useCustomerSummary } from '@/modules/customers/api';
import type { Customer } from '@/modules/customers/types';
import { useListQuery } from '@/modules/operations/api';
import { apiFetch } from '@/services/http';

const customerName = (c: Customer): string => (c.type === 'business' ? c.companyName : `${c.firstName} ${c.lastName}`.trim());

/**
 * Replaces raw "Customer ID / Property ID" text boxes: search for a customer, then choose one of
 * their properties. Values may be pre-filled from URL parameters by the parent form.
 */
export function CustomerPropertyPicker({
  customerId,
  propertyId,
  onChange,
  requireProperty = true,
  showCustomer = true,
}: {
  customerId: string;
  propertyId: string;
  onChange: (v: { customerId: string; propertyId: string }) => void;
  requireProperty?: boolean;
  showCustomer?: boolean;
}): React.ReactElement {
  const [search, setSearch] = useState('');
  const results = useQuery({
    queryKey: ['picker-customers', search],
    enabled: search.trim().length >= 2 && !customerId,
    queryFn: () => apiFetch<{ data: Customer[] }>(`/customers?search=${encodeURIComponent(search)}&pageSize=8`),
  });
  const summary = useCustomerSummary(customerId);
  const chosen = summary.data?.data.customer;
  const properties = summary.data?.data.properties ?? [];

  return (
    <div className="space-y-4">
      {showCustomer ? (
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Customer</p>
          {customerId ? (
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
              <span className="font-medium">{chosen ? customerName(chosen) : '…'}</span>
              <span className="text-muted-foreground">{chosen?.phone || chosen?.email}</span>
              <Button type="button" size="sm" variant="outline" onClick={() => { onChange({ customerId: '', propertyId: '' }); setSearch(''); }}>Change</Button>
            </div>
          ) : (
            <>
              <SearchInput value={search} onChange={setSearch} placeholder="Search customers by name, phone or email" />
              {results.data?.data.length ? (
                <ul className="divide-y divide-border rounded-md border border-border bg-card">
                  {results.data.data.map((c) => (
                    <li key={c.id}>
                      <button type="button" className="flex w-full justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => onChange({ customerId: c.id, propertyId: '' })}>
                        <span className="font-medium">{customerName(c)}</span>
                        <span className="text-muted-foreground">{c.phone || c.email}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {results.data && results.data.data.length === 0 ? <p className="text-sm text-muted-foreground">No customers found.</p> : null}
            </>
          )}
        </div>
      ) : null}
      {customerId ? (
        <FormField label="Property" htmlFor="picker-property">
          <select id="picker-property" className={selectClass} required={requireProperty} value={propertyId} onChange={(e) => onChange({ customerId, propertyId: e.target.value })}>
            <option value="">{properties.length ? 'Select a property…' : 'This customer has no properties yet'}</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>{p.address.line1}, {p.address.city} {p.address.zip}</option>
            ))}
          </select>
        </FormField>
      ) : null}
    </div>
  );
}

/** Optional link to an existing record (inspection, measurement, proposal, project…), loaded from its list API. */
export function LinkedRecordSelect<T extends { id: string }>({
  id,
  label,
  value,
  onChange,
  path,
  params,
  describe,
  enabled = true,
  noneLabel = 'None',
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  path: string;
  params: Record<string, string | undefined>;
  describe: (row: T) => string;
  enabled?: boolean;
  noneLabel?: string;
}): React.ReactElement | null {
  const q = useListQuery<T>(`link-${id}`, path, { ...params, pageSize: 50 });
  if (!enabled) return null;
  return (
    <FormField label={label} htmlFor={id}>
      <select id={id} className={selectClass} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{noneLabel}</option>
        {(q.data?.data ?? []).map((r) => <option key={r.id} value={r.id}>{describe(r)}</option>)}
      </select>
    </FormField>
  );
}
