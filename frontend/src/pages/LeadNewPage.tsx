import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCreateLead, useDuplicateCheck } from '@/modules/leads/api';
import { useLookups } from '@/modules/settings/api';
import { ApiError } from '@/types/api';

export function LeadNewPage(): React.ReactElement {
  const navigate = useNavigate();
  const createLead = useCreateLead();
  const duplicateCheck = useDuplicateCheck();
  const sources = useLookups('lead_source');
  const services = useLookups('project_category');
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    companyName: '',
    phone: '',
    email: '',
    sourceKey: 'door_knocking',
    serviceInterestKey: '',
    priority: 'normal',
    line1: '',
    city: '',
    state: 'TX',
    zip: '',
    notes: '',
  });
  const [matches, setMatches] = useState<Array<{ entityType: string; id: string; label: string }>>(
    [],
  );
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    try {
      const check = await duplicateCheck.mutateAsync({
        phone: form.phone || undefined,
        email: form.email || undefined,
        address: form.line1 && form.zip ? { line1: form.line1, zip: form.zip } : undefined,
      });
      setMatches(check.data);
      if (check.data.length > 0 && !window.confirm('Possible duplicates found. Continue anyway?')) {
        return;
      }
      const res = await createLead.mutateAsync({
        firstName: form.firstName || undefined,
        lastName: form.lastName || undefined,
        companyName: form.companyName || undefined,
        phone: form.phone || undefined,
        email: form.email || undefined,
        sourceKey: form.sourceKey,
        serviceInterestKey: form.serviceInterestKey || undefined,
        priority: form.priority as 'low' | 'normal' | 'high',
        notes: form.notes || undefined,
        address:
          form.line1 || form.zip
            ? { line1: form.line1, city: form.city, state: form.state, zip: form.zip }
            : undefined,
      });
      void navigate(`/app/leads/${res.data.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create lead.');
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <PageHeader title="New lead" description="Door knock, phone, or referral entry." />
      <form
        className="space-y-4 rounded-xl border border-border bg-card p-4"
        onSubmit={(e) => void onSubmit(e)}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="firstName">First name</Label>
            <Input
              id="firstName"
              value={form.firstName}
              onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lastName">Last name</Label>
            <Input
              id="lastName"
              value={form.lastName}
              onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="companyName">Company</Label>
          <Input
            id="companyName"
            value={form.companyName}
            onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="phone">Phone</Label>
            <Input
              id="phone"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="sourceKey">Source</Label>
          <select
            id="sourceKey"
            className="flex h-10 w-full rounded-md border border-border bg-card px-3 text-sm"
            value={form.sourceKey}
            onChange={(e) => setForm((f) => ({ ...f, sourceKey: e.target.value }))}
          >
            {(sources.data?.data ?? [{ key: 'door_knocking', label: 'Door knocking' }]).map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="serviceInterestKey">Service type</Label>
            <select
              id="serviceInterestKey"
              className="flex h-10 w-full rounded-md border border-border bg-card px-3 text-sm"
              value={form.serviceInterestKey}
              onChange={(e) => setForm((f) => ({ ...f, serviceInterestKey: e.target.value }))}
            >
              <option value="">Not specified</option>
              {(services.data?.data ?? []).filter((s) => s.isActive).map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="priority">Priority</Label>
            <select
              id="priority"
              className="flex h-10 w-full rounded-md border border-border bg-card px-3 text-sm"
              value={form.priority}
              onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
            </select>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="line1">Address</Label>
          <Input
            id="line1"
            value={form.line1}
            onChange={(e) => setForm((f) => ({ ...f, line1: e.target.value }))}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Input
            placeholder="City"
            aria-label="City"
            value={form.city}
            onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
          />
          <Input
            placeholder="State"
            aria-label="State"
            value={form.state}
            onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
          />
          <Input
            placeholder="ZIP"
            aria-label="ZIP"
            value={form.zip}
            onChange={(e) => setForm((f) => ({ ...f, zip: e.target.value }))}
          />
        </div>
        {matches.length > 0 ? (
          <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
            <p className="font-medium">Possible duplicates</p>
            <ul className="mt-1 list-disc pl-5">
              {matches.map((m) => (
                <li key={`${m.entityType}-${m.id}`}>
                  {m.entityType}: {m.label}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button type="submit" disabled={createLead.isPending}>
          Save lead
        </Button>
      </form>
    </div>
  );
}
