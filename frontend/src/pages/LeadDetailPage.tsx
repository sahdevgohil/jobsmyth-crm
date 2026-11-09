import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/shared/PageHeader';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { selectClass } from '@/components/shared/FormField';
import { useHasPermission } from '@/lib/permissions';
import { leadKeys } from '@/modules/leads/api';
import { useStaffDirectory } from '@/modules/users/api';
import { apiFetch } from '@/services/http';
import { ErrorState, LoadingState } from '@/components/shared/StatePanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  useChangeLeadStage,
  useCompleteActivity,
  useConvertLead,
  useCreateActivity,
  useLead,
  useLeadActivities,
  usePipelineStages,
} from '@/modules/leads/api';
import { useLookups } from '@/modules/settings/api';
import { ApiError } from '@/types/api';

export function LeadDetailPage(): React.ReactElement {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const lead = useLead(id);
  const stages = usePipelineStages();
  const activities = useLeadActivities(id);
  const changeStage = useChangeLeadStage(id);
  const convert = useConvertLead(id);
  const createActivity = useCreateActivity();
  const completeActivity = useCompleteActivity();
  const lostReasons = useLookups('lost_reason');
  const qc = useQueryClient();
  const canAssign = useHasPermission('leads:assign');
  const staff = useStaffDirectory();
  const [assignee, setAssignee] = useState('');
  const [note, setNote] = useState('');
  const [followUpDue, setFollowUpDue] = useState('');
  const [stageId, setStageId] = useState('');
  const [lostReasonKey, setLostReasonKey] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (lead.isLoading) return <LoadingState />;
  if (lead.isError || !lead.data) {
    return (
      <ErrorState
        message={lead.error instanceof ApiError ? lead.error.message : 'Lead not found.'}
        onRetry={() => void lead.refetch()}
      />
    );
  }

  const data = lead.data.data;
  const openStages = (stages.data?.data ?? []).filter(
    (s) => s.isActive && (s.category === 'open' || s.category === 'lost'),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={data.companyName || `${data.firstName} ${data.lastName}`.trim() || 'Lead'}
        description={`${data.phone || data.email} · ${data.sourceKey}`}
        actions={
          !data.convertedCustomerId ? (
            <Button
              onClick={() => {
                void convert.mutateAsync({}).then((res) => {
                  void navigate(`/app/customers/${res.data.customerId}`);
                });
              }}
            >
              Convert
            </Button>
          ) : (
            <Button asChild variant="outline">
              <Link to={`/app/customers/${data.convertedCustomerId}`}>View customer</Link>
            </Button>
          )
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-xl border border-border bg-card p-4 text-sm lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold">Lead details</h2>
          <dl className="grid grid-cols-[130px_1fr] gap-y-2">
            <dt className="text-muted-foreground">Stage</dt><dd><StatusBadge status={stages.data?.data.find((x) => x.id === data.stageId)?.name ?? '—'} tone="neutral" /></dd>
            <dt className="text-muted-foreground">Priority</dt><dd><StatusBadge status={data.priority ?? 'normal'} /></dd>
            <dt className="text-muted-foreground">Service</dt><dd className="capitalize">{(data.serviceInterestKey || '—').replace(/_/g, ' ')}</dd>
            <dt className="text-muted-foreground">Phone / email</dt><dd>{[data.phone, data.email].filter(Boolean).join(' · ') || '—'}</dd>
            <dt className="text-muted-foreground">Address</dt><dd>{[data.address.line1, data.address.city, [data.address.state, data.address.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ') || '—'}</dd>
            <dt className="text-muted-foreground">Notes</dt><dd>{data.notes || '—'}</dd>
            <dt className="text-muted-foreground">Created</dt><dd>{new Date(data.createdAt).toLocaleDateString('en-US')}</dd>
          </dl>
        </section>
        <section className="rounded-xl border border-border bg-card p-4 text-sm">
          <h2 className="mb-3 text-sm font-semibold">Assigned salesperson</h2>
          <p className="mb-3 font-medium">
            {(() => {
              const u = staff.data?.data.find((x) => x.id === data.assignedTo);
              return u ? `${u.firstName} ${u.lastName}` : '—';
            })()}
          </p>
          {canAssign && !data.convertedCustomerId ? (
            <div className="space-y-2">
              <select aria-label="Reassign lead" className={selectClass} value={assignee || data.assignedTo} onChange={(e) => setAssignee(e.target.value)}>
                {(staff.data?.data ?? []).filter((u) => u.role === 'salesperson').map((u) => (
                  <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>
                ))}
              </select>
              <Button
                variant="outline"
                disabled={!assignee || assignee === data.assignedTo}
                onClick={() => {
                  setError(null);
                  void apiFetch(`/leads/${id}/assign`, { method: 'POST', body: JSON.stringify({ assignedTo: assignee }) })
                    .then(() => { setAssignee(''); void qc.invalidateQueries({ queryKey: leadKeys.all }); void qc.invalidateQueries({ queryKey: ['activities'] }); })
                    .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Assignment failed.'));
                }}
              >
                Assign
              </Button>
            </div>
          ) : null}
        </section>
      </div>

      {!data.convertedCustomerId ? (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-2">
            <Label>Change stage</Label>
            <select
              className="flex h-10 w-full rounded-md border border-border bg-card px-3 text-sm"
              value={stageId || data.stageId}
              onChange={(e) => setStageId(e.target.value)}
            >
              {openStages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          {(stages.data?.data.find((s) => s.id === (stageId || data.stageId))?.category ===
            'lost') && (
            <div className="flex-1 space-y-2">
              <Label>Lost reason</Label>
              <select
                className="flex h-10 w-full rounded-md border border-border bg-card px-3 text-sm"
                value={lostReasonKey}
                onChange={(e) => setLostReasonKey(e.target.value)}
              >
                <option value="">Select…</option>
                {(lostReasons.data?.data ?? []).map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <Button
            onClick={() => {
              setError(null);
              void changeStage
                .mutateAsync({
                  stageId: stageId || data.stageId,
                  lostReasonKey: lostReasonKey || undefined,
                })
                .catch((err: unknown) => {
                  setError(err instanceof ApiError ? err.message : 'Stage change failed.');
                });
            }}
          >
            Update stage
          </Button>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Add note / follow-up</h2>
          <Input
            placeholder="Note or call summary"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Input
            type="datetime-local"
            value={followUpDue}
            onChange={(e) => setFollowUpDue(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() =>
                void createActivity.mutateAsync({
                  entityType: 'lead',
                  entityId: id,
                  type: 'note',
                  body: note,
                }).then(() => setNote(''))
              }
            >
              Add note
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                if (!followUpDue) return;
                void createActivity
                  .mutateAsync({
                    entityType: 'lead',
                    entityId: id,
                    type: 'follow_up',
                    body: note || 'Follow-up',
                    dueAt: new Date(followUpDue).toISOString(),
                  })
                  .then(() => {
                    setNote('');
                    setFollowUpDue('');
                  });
              }}
            >
              Add follow-up
            </Button>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold">Timeline</h2>
          <ul className="space-y-2 text-sm">
            {(activities.data?.data ?? []).map((a) => (
              <li key={a.id} className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{a.type}</p>
                  <p className="text-muted-foreground">{a.body}</p>
                  {a.dueAt && !a.completedAt ? (
                    <p className="text-xs text-destructive">Due {new Date(a.dueAt).toLocaleString()}</p>
                  ) : null}
                </div>
                {a.type === 'follow_up' && !a.completedAt ? (
                  <Button size="sm" variant="outline" onClick={() => void completeActivity.mutateAsync(a.id)}>
                    Done
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
