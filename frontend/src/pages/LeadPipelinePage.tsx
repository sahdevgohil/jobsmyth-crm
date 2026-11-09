import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/shared/PageHeader';
import { ErrorState, LoadingState } from '@/components/shared/StatePanel';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { useHasPermission } from '@/lib/permissions';
import { leadKeys, useLeads, usePipelineStages } from '@/modules/leads/api';
import type { Lead, PipelineStage } from '@/modules/leads/types';
import { useLookups } from '@/modules/settings/api';
import { apiFetch } from '@/services/http';
import { ApiError } from '@/types/api';

const title = (l: Lead): string => l.companyName || `${l.firstName} ${l.lastName}`.trim() || 'Untitled';

/**
 * Lead board. Dragging a card (or using its keyboard-accessible select) calls the same backend
 * stage-change / conversion endpoints as the lead detail page, so all server rules still apply:
 * Won is reached only via conversion, Lost requires a reason, converted leads are locked.
 */
export function LeadPipelinePage(): React.ReactElement {
  const stages = usePipelineStages();
  const leads = useLeads({ pageSize: '100' });
  const reasons = useLookups('lost_reason');
  const qc = useQueryClient();
  const canUpdate = useHasPermission('leads:update');
  const canConvert = useHasPermission('leads:convert');
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [lostFor, setLostFor] = useState<{ lead: Lead; stage: PipelineStage } | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const columns = (stages.data?.data ?? []).filter((s) => s.isActive).sort((a, b) => a.order - b.order);
  const rows = leads.data?.data ?? [];

  async function run(fn: () => Promise<unknown>, ok: string): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(ok);
      await qc.invalidateQueries({ queryKey: leadKeys.all });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not move the lead.');
    } finally {
      setBusy(false);
    }
  }

  function moveTo(lead: Lead, stage: PipelineStage): void {
    if (lead.stageId === stage.id || busy) return;
    if (lead.convertedCustomerId) {
      setError('Converted leads are locked and cannot be moved.');
      return;
    }
    if (stage.category === 'won') {
      if (!canConvert) {
        setError('You do not have permission to convert leads.');
        return;
      }
      if (!window.confirm(`Convert ${title(lead)} to a customer? This moves the lead to Won.`)) return;
      void run(() => apiFetch(`/leads/${lead.id}/convert`, { method: 'POST', body: JSON.stringify({}) }), `${title(lead)} converted to a customer.`);
      return;
    }
    if (stage.category === 'lost') {
      setReason('');
      setLostFor({ lead, stage });
      return;
    }
    void run(() => apiFetch(`/leads/${lead.id}/stage`, { method: 'POST', body: JSON.stringify({ stageId: stage.id }) }), `Moved to ${stage.name}.`);
  }

  if (stages.isLoading || leads.isLoading) return <LoadingState />;
  if (stages.isError || leads.isError) {
    return <ErrorState message="Failed to load the pipeline." onRetry={() => { void stages.refetch(); void leads.refetch(); }} />;
  }

  return (
    <div>
      <PageHeader
        title="Pipeline board"
        description="Drag a card to another stage, or use the card menu. Won is reached by converting the lead; Lost asks for a reason."
        actions={<Button asChild variant="outline"><Link to="/app/leads">List view</Link></Button>}
      />
      {error ? <p role="alert" className="mb-3 rounded-md border border-danger/30 bg-card p-3 text-sm text-danger">{error}</p> : null}
      {notice ? <p role="status" className="mb-3 text-sm text-success">{notice}</p> : null}
      {(leads.data?.meta.total ?? 0) > 100 ? <p className="mb-3 text-xs text-warning">Showing the 100 most recent leads of {leads.data?.meta.total}. Use the list view for the rest.</p> : null}

      <div className="flex gap-3 overflow-x-auto pb-3">
        {columns.map((stage) => {
          const cards = rows.filter((l) => l.stageId === stage.id);
          return (
            <section
              key={stage.id}
              aria-label={`${stage.name} stage`}
              onDragOver={(e) => { if (canUpdate) { e.preventDefault(); setOver(stage.id); } }}
              onDragLeave={() => setOver((o) => (o === stage.id ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const lead = rows.find((l) => l.id === (dragId ?? e.dataTransfer.getData('text/plain')));
                setDragId(null);
                if (lead) moveTo(lead, stage);
              }}
              className={cn('w-64 shrink-0 rounded-lg border bg-muted/50 p-2', over === stage.id ? 'border-brand bg-brand-soft' : 'border-border', stage.category === 'won' && 'border-t-4 border-t-success', stage.category === 'lost' && 'border-t-4 border-t-danger')}
            >
              <h2 className="mb-2 flex items-center justify-between px-1 text-sm font-semibold">
                {stage.name}
                <span className="rounded-full bg-card px-2 text-xs font-normal text-muted-foreground">{cards.length}</span>
              </h2>
              <ul className="space-y-2">
                {cards.map((lead) => (
                  <li
                    key={lead.id}
                    draggable={canUpdate && !lead.convertedCustomerId}
                    onDragStart={(e) => { setDragId(lead.id); e.dataTransfer.setData('text/plain', lead.id); e.dataTransfer.effectAllowed = 'move'; }}
                    onDragEnd={() => { setDragId(null); setOver(null); }}
                    className={cn('rounded-md border border-border bg-card p-2.5 text-sm shadow-sm', canUpdate && !lead.convertedCustomerId && 'cursor-grab active:cursor-grabbing', dragId === lead.id && 'opacity-50')}
                  >
                    <Link className="font-medium text-foreground hover:text-brand hover:underline" to={`/app/leads/${lead.id}`}>{title(lead)}</Link>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{[(lead.serviceInterestKey || '').replace(/_/g, ' '), lead.phone].filter(Boolean).join(' · ') || '—'}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      {lead.priority === 'high' ? <StatusBadge status="high" /> : null}
                      {lead.hasOverdueFollowUp ? <StatusBadge status="overdue" tone="danger" /> : null}
                      {lead.convertedCustomerId ? <StatusBadge status="converted" tone="success" /> : null}
                    </div>
                    {canUpdate && !lead.convertedCustomerId ? (
                      <select
                        aria-label={`Move ${title(lead)} to stage`}
                        className="mt-2 flex h-8 w-full rounded-md border border-border bg-card px-2 text-xs"
                        value={lead.stageId}
                        disabled={busy}
                        onChange={(e) => { const s = columns.find((c) => c.id === e.target.value); if (s) moveTo(lead, s); }}
                      >
                        {columns.map((s) => <option key={s.id} value={s.id}>Move to {s.name}</option>)}
                      </select>
                    ) : null}
                  </li>
                ))}
                {cards.length === 0 ? <li className="px-1 py-4 text-center text-xs text-muted-foreground">No leads</li> : null}
              </ul>
            </section>
          );
        })}
      </div>

      {lostFor ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Mark lead as lost">
          <form
            className="w-full max-w-sm space-y-3 rounded-lg bg-card p-4 shadow-lg"
            onSubmit={(e) => {
              e.preventDefault();
              const { lead, stage } = lostFor;
              setLostFor(null);
              void run(() => apiFetch(`/leads/${lead.id}/stage`, { method: 'POST', body: JSON.stringify({ stageId: stage.id, lostReasonKey: reason }) }), `${title(lead)} marked as lost.`);
            }}
          >
            <h2 className="text-base font-semibold">Mark {title(lostFor.lead)} as lost</h2>
            <label className="block text-sm font-medium" htmlFor="lost-reason">Reason</label>
            <select id="lost-reason" required className="flex h-10 w-full rounded-md border border-border bg-card px-3 text-sm" value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">Select a reason…</option>
              {(reasons.data?.data ?? []).filter((r) => r.isActive).map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
            <div className="flex gap-2">
              <Button type="submit" disabled={!reason}>Mark lost</Button>
              <Button type="button" variant="outline" onClick={() => setLostFor(null)}>Cancel</Button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
