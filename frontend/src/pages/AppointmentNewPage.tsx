import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CustomerPropertyPicker } from '@/components/shared/EntityPickers';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { COMPANY_TZ, isoToZonedInput, zonedInputToISO } from '@/lib/datetime';
import { useHasPermission } from '@/lib/permissions';
import { useCreateAppointment } from '@/modules/appointments/api';
import { useStaffDirectory } from '@/modules/users/api';
import { useLookups } from '@/modules/settings/api';
import { useAuthStore } from '@/stores/auth-store';
import { ApiError } from '@/types/api';

/** Default slot: the requested day (or today) at 9:00 company time, one hour long. */
function defaultSlot(date: string | null): { start: string; end: string } {
  const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : isoToZonedInput(new Date().toISOString()).slice(0, 10);
  return { start: `${day}T09:00`, end: `${day}T10:00` };
}

export function AppointmentNewPage(): React.ReactElement {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const create = useCreateAppointment();
  const types = useLookups('appointment_type');
  const userId = useAuthStore((s) => s.user?.id);
  const slot = defaultSlot(params.get('date'));
  const isAdmin = useHasPermission('leads:assign');
  const staff = useStaffDirectory();
  const [form, setForm] = useState({
    title: 'Site visit',
    typeKey: 'inspection',
    startLocal: slot.start,
    endLocal: slot.end,
    assignedTo: userId ?? '',
    location: '',
    notes: '',
    customerId: params.get('customerId') ?? '',
    leadId: params.get('leadId') ?? '',
    propertyId: params.get('propertyId') ?? '',
    force: false,
  });
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    try {
      const startAt = zonedInputToISO(form.startLocal);
      const endAt = zonedInputToISO(form.endLocal);
      if (endAt <= startAt) {
        setError('End must be after the start.');
        return;
      }
      const res = await create.mutateAsync({
        title: form.title,
        typeKey: form.typeKey,
        startAt,
        endAt,
        timeZone: COMPANY_TZ,
        location: form.location || undefined,
        notes: form.notes || undefined,
        customerId: form.customerId || undefined,
        leadId: form.leadId || undefined,
        propertyId: form.propertyId || undefined,
        assignedTo: form.assignedTo || userId,
        force: form.force || undefined,
      });
      void navigate(`/app/appointments/${res.data.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'SCHEDULE_CONFLICT') {
        setError('Schedule conflict with another appointment. Check “Force schedule” to override.');
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Could not create appointment.');
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <PageHeader title="New appointment" description="Times are entered in company time (Central)." />
      <form className="space-y-4 rounded-xl border border-border bg-card p-4" onSubmit={(e) => void onSubmit(e)}>
        <div className="space-y-2">
          <Label htmlFor="title">Title</Label>
          <Input
            id="title"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="typeKey">Type</Label>
          <select
            id="typeKey"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={form.typeKey}
            onChange={(e) => setForm((f) => ({ ...f, typeKey: e.target.value }))}
          >
            {(types.data?.data ?? [{ key: 'inspection', label: 'Inspection' }]).map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="start">Start</Label>
            <Input
              id="start"
              type="datetime-local"
              value={form.startLocal}
              onChange={(e) => setForm((f) => ({ ...f, startLocal: e.target.value }))}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="end">End</Label>
            <Input
              id="end"
              type="datetime-local"
              value={form.endLocal}
              onChange={(e) => setForm((f) => ({ ...f, endLocal: e.target.value }))}
              required
            />
          </div>
        </div>
        <CustomerPropertyPicker customerId={form.customerId} propertyId={form.propertyId} requireProperty={false} onChange={(v) => setForm((f) => ({ ...f, ...v }))} />
        {isAdmin ? (
          <div className="space-y-2">
            <Label htmlFor="assignedTo">Assigned to</Label>
            <select id="assignedTo" className="flex h-10 w-full rounded-md border border-border bg-card px-3 text-sm" value={form.assignedTo} onChange={(e) => setForm((f) => ({ ...f, assignedTo: e.target.value }))}>
              {(staff.data?.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>{u.firstName} {u.lastName} ({u.role})</option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="space-y-2">
          <Label htmlFor="location">Location</Label>
          <Input
            id="location"
            value={form.location}
            onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="notes">Notes</Label>
          <textarea
            id="notes"
            className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.force}
            onChange={(e) => setForm((f) => ({ ...f, force: e.target.checked }))}
          />
          Force schedule despite conflicts
        </label>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? 'Saving…' : 'Create appointment'}
        </Button>
      </form>
    </div>
  );
}
