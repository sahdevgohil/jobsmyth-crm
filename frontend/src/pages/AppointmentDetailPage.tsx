import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '@/components/shared/PageHeader';
import { ErrorState, LoadingState } from '@/components/shared/StatePanel';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { formatDateTime, isoToZonedInput, zonedInputToISO } from '@/lib/datetime';
import { useHasPermission } from '@/lib/permissions';
import { statusLabel } from '@/lib/status';
import { useStaffDirectory } from '@/modules/users/api';
import { useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/services/http';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  useAppointment,
  useAppointmentReminders,
  useCancelAppointment,
  useRescheduleAppointment,
} from '@/modules/appointments/api';
import { ApiError } from '@/types/api';

export function AppointmentDetailPage(): React.ReactElement {
  const { id = '' } = useParams();
  const appt = useAppointment(id);
  const cancel = useCancelAppointment(id);
  const reschedule = useRescheduleAppointment(id);
  const reminders = useAppointmentReminders(id);
  const [reason, setReason] = useState('');
  const qc = useQueryClient();
  const staff = useStaffDirectory();
  const isAdmin = useHasPermission('leads:assign');
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState({ title: '', location: '', notes: '', assignedTo: '', status: '' });
  const [startLocal, setStartLocal] = useState('');
  const [endLocal, setEndLocal] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (appt.isLoading) return <LoadingState />;
  if (appt.isError || !appt.data) {
    return (
      <ErrorState
        message={appt.error instanceof ApiError ? appt.error.message : 'Appointment not found.'}
        onRetry={() => void appt.refetch()}
      />
    );
  }
  const a = appt.data.data;
  const canAct = a.status === 'scheduled' || a.status === 'confirmed';

  return (
    <div className="space-y-6">
      <PageHeader
        title={a.title}
        description={`${statusLabel(a.typeKey)} · ${staff.data?.data.find((u) => u.id === a.assignedTo) ? `${staff.data.data.find((u) => u.id === a.assignedTo)?.firstName} ${staff.data.data.find((u) => u.id === a.assignedTo)?.lastName}` : ''}`}
        actions={
          <>
            <StatusBadge status={a.status} />
            {canAct && !editing ? (
              <Button variant="outline" onClick={() => { setEdit({ title: a.title, location: a.location, notes: a.notes, assignedTo: a.assignedTo, status: a.status }); setEditing(true); }}>Edit</Button>
            ) : null}
            <Button asChild variant="outline"><Link to="/app/appointments/calendar">Calendar</Link></Button>
          </>
        }
      />
      <div className="rounded-xl border border-border bg-card p-4 text-sm space-y-2">
        <p>
          <span className="text-muted-foreground">When: </span>
          {formatDateTime(a.startAt, a.timeZone)} – {formatDateTime(a.endAt, a.timeZone)} ({a.timeZone})
        </p>
        <p>
          <span className="text-muted-foreground">Location: </span>
          {a.location || '—'}
        </p>
        <p>
          <span className="text-muted-foreground">Notes: </span>
          {a.notes || '—'}
        </p>
        {a.customerId ? (
          <p>
            <Link className="text-brand underline" to={`/app/customers/${a.customerId}`}>
              Open customer
            </Link>
          </p>
        ) : null}
        {a.leadId ? (
          <p>
            <Link className="text-brand underline" to={`/app/leads/${a.leadId}`}>
              Open lead
            </Link>
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Reminders — email: {a.reminder.emailStatus}, SMS: {a.reminder.smsStatus}
          {a.reminder.emailStatus === 'not_configured' || a.reminder.smsStatus === 'not_configured'
            ? ' (external providers not configured)'
            : ''}
        </p>
      </div>

      {editing ? (
        <form
          className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            void apiFetch(`/appointments/${id}`, {
              method: 'PATCH',
              body: JSON.stringify({ title: edit.title, location: edit.location, notes: edit.notes, status: edit.status, ...(isAdmin ? { assignedTo: edit.assignedTo } : {}) }),
            })
              .then(() => { setMsg('Saved.'); setEditing(false); void qc.invalidateQueries({ queryKey: ['appointments'] }); })
              .catch((err) => {
                if (err instanceof ApiError && err.code === 'SCHEDULE_CONFLICT' && window.confirm('This assignee already has an appointment at that time. Save anyway?')) {
                  void apiFetch(`/appointments/${id}`, { method: 'PATCH', body: JSON.stringify({ title: edit.title, location: edit.location, notes: edit.notes, status: edit.status, assignedTo: edit.assignedTo, force: true }) })
                    .then(() => { setMsg('Saved.'); setEditing(false); void qc.invalidateQueries({ queryKey: ['appointments'] }); })
                    .catch((e2) => setError(e2 instanceof ApiError ? e2.message : 'Save failed.'));
                  return;
                }
                setError(err instanceof ApiError ? err.message : 'Save failed.');
              });
          }}
        >
          <div className="space-y-2 sm:col-span-2"><Label htmlFor="e-title">Title</Label><Input id="e-title" value={edit.title} onChange={(e) => setEdit((v) => ({ ...v, title: e.target.value }))} required /></div>
          <div className="space-y-2"><Label htmlFor="e-loc">Location</Label><Input id="e-loc" value={edit.location} onChange={(e) => setEdit((v) => ({ ...v, location: e.target.value }))} /></div>
          <div className="space-y-2"><Label htmlFor="e-status">Status</Label>
            <select id="e-status" className="flex h-10 w-full rounded-md border border-border bg-card px-3 text-sm" value={edit.status} onChange={(e) => setEdit((v) => ({ ...v, status: e.target.value }))}>
              {['scheduled', 'confirmed', 'completed', 'no_show'].map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
            </select>
          </div>
          {isAdmin ? (
            <div className="space-y-2"><Label htmlFor="e-who">Assigned to</Label>
              <select id="e-who" className="flex h-10 w-full rounded-md border border-border bg-card px-3 text-sm" value={edit.assignedTo} onChange={(e) => setEdit((v) => ({ ...v, assignedTo: e.target.value }))}>
                {(staff.data?.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}
              </select>
            </div>
          ) : null}
          <div className="space-y-2 sm:col-span-2"><Label htmlFor="e-notes">Notes</Label><Input id="e-notes" value={edit.notes} onChange={(e) => setEdit((v) => ({ ...v, notes: e.target.value }))} /></div>
          <div className="flex gap-2 sm:col-span-2"><Button type="submit">Save changes</Button><Button type="button" variant="outline" onClick={() => setEditing(false)}>Cancel</Button></div>
        </form>
      ) : null}

      {canAct ? (
        <div className="grid gap-4 md:grid-cols-2">
          <form
            className="space-y-3 rounded-xl border border-border bg-card p-4"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              void cancel
                .mutateAsync({ reason: reason || undefined })
                .then(() => setMsg('Cancelled.'))
                .catch((err) =>
                  setError(err instanceof ApiError ? err.message : 'Cancel failed.'),
                );
            }}
          >
            <h2 className="font-medium">Cancel</h2>
            <Input
              placeholder="Reason (optional)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <Button type="submit" variant="outline" disabled={cancel.isPending}>
              Cancel appointment
            </Button>
          </form>

          <form
            className="space-y-3 rounded-xl border border-border bg-card p-4"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              void reschedule
                .mutateAsync({ startAt: zonedInputToISO(startLocal), endAt: zonedInputToISO(endLocal) })
                .then(() => setMsg('Rescheduled.'))
                .catch((err) => {
                  if (err instanceof ApiError && err.code === 'SCHEDULE_CONFLICT') {
                    if (window.confirm('This assignee already has an appointment at that time. Reschedule anyway?')) {
                      void reschedule
                        .mutateAsync({ startAt: zonedInputToISO(startLocal), endAt: zonedInputToISO(endLocal), force: true })
                        .then(() => setMsg('Rescheduled.'))
                        .catch((e2) => setError(e2 instanceof ApiError ? e2.message : 'Reschedule failed.'));
                    }
                    return;
                  }
                  setError(err instanceof ApiError ? err.message : 'Reschedule failed.');
                });
            }}
          >
            <h2 className="font-medium">Reschedule</h2>
            <p className="text-xs text-muted-foreground">Current: {isoToZonedInput(a.startAt, a.timeZone).replace('T', ' ')} ({a.timeZone}). Enter new times in company time.</p>
            <div className="space-y-2">
              <Label>Start</Label>
              <Input type="datetime-local" value={startLocal} onChange={(e) => setStartLocal(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>End</Label>
              <Input type="datetime-local" value={endLocal} onChange={(e) => setEndLocal(e.target.value)} required />
            </div>
            <Button type="submit" disabled={reschedule.isPending}>
              Save new times
            </Button>
          </form>
        </div>
      ) : null}

      {canAct ? (
        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <h2 className="font-medium">Reminders</h2>
          <p className="text-xs text-muted-foreground">
            Internal notification is sent when available. Email/SMS require Resend/Twilio configuration.
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={reminders.isPending}
            onClick={() =>
              void reminders
                .mutateAsync({ email: true, sms: true })
                .then(() => setMsg('Reminder requested (internal + provider status updated).'))
                .catch((err) =>
                  setError(err instanceof ApiError ? err.message : 'Reminder failed.'),
                )
            }
          >
            Request reminders
          </Button>
        </div>
      ) : null}

      {a.customerId && a.propertyId ? (
        <Button asChild>
          <Link
            to={`/app/inspections/new?customerId=${a.customerId}&propertyId=${a.propertyId}&appointmentId=${a.id}`}
          >
            Start inspection
          </Link>
        </Button>
      ) : null}

      {msg ? <p className="text-sm text-brand">{msg}</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
