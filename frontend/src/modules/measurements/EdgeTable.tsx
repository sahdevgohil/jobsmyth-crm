import { useState } from 'react';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useHasPermission } from '@/lib/permissions';
import { ApiError } from '@/types/api';
import { EDGE_LABEL, EDGE_TYPES, useWorkspaceMutations, type EdgeType, type RoofEdge } from './workspaceApi';

const statusText = (e: RoofEdge): string =>
  e.source === 'manual' ? (e.verification === 'verified' ? 'Field verified (entered by staff)' : 'Manually entered')
  : e.verification === 'verified' ? 'Field verified'
  : e.verification === 'needs_verification' || e.lengthFt === null ? 'Needs verification'
  : 'Automatically derived (not verified)';

type Draft = { type?: EdgeType; length?: string; included?: boolean; note?: string };

/** Review table for roof edges. Derived values are never treated as measured until a person verifies them. */
export function EdgeTable({ measurementId, edges, editable }: { measurementId: string; edges: RoofEdge[]; editable: boolean }): React.ReactElement {
  const mut = useWorkspaceMutations(measurementId);
  const canVerify = useHasPermission('measurements:verify');
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [adding, setAdding] = useState<{ type: EdgeType; length: string; note: string }>({ type: 'ridge', length: '', note: '' });
  const set = (id: string, d: Draft): void => setDrafts((cur) => ({ ...cur, [id]: { ...cur[id], ...d } }));
  const fail = (e: unknown): void => setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Could not save.' });
  const needReason = (): boolean => { if (reason.trim().length < 3) { setMsg({ ok: false, text: 'Enter a reason for the change first.' }); return false; } return true; };

  async function save(e: RoofEdge, verify = false): Promise<void> {
    if (!needReason()) return;
    const d = drafts[e.id] ?? {};
    try {
      await mut.patchEdge.mutateAsync({
        edgeId: e.id, reason,
        ...(d.type && d.type !== e.type ? { type: d.type } : {}),
        ...(d.length !== undefined && Number(d.length) !== e.lengthFt ? { lengthFt: d.length.trim() === '' ? null : Number(d.length) } : {}),
        ...(d.included !== undefined && d.included !== e.included ? { included: d.included } : {}),
        ...(d.note !== undefined && d.note !== e.note ? { note: d.note } : {}),
        ...(verify ? { verification: 'verified' as const } : {}),
      });
      setDrafts((cur) => { const n = { ...cur }; delete n[e.id]; return n; });
      setMsg({ ok: true, text: `Edge ${e.id} saved.` });
    } catch (err) { fail(err); }
  }
  async function verifyConfident(): Promise<void> {
    if (!needReason()) return;
    try { await mut.verifyEdges.mutateAsync({ reason }); setMsg({ ok: true, text: 'Confident edges verified. Edges that need verification were left alone.' }); } catch (err) { fail(err); }
  }
  async function add(): Promise<void> {
    if (!needReason()) return;
    try { await mut.addEdge.mutateAsync({ type: adding.type, lengthFt: Number(adding.length), note: adding.note || undefined, reason }); setAdding({ type: adding.type, length: '', note: '' }); setMsg({ ok: true, text: 'Edge added.' }); } catch (err) { fail(err); }
  }

  const confident = edges.filter((e) => e.included && e.lengthFt !== null && e.verification === 'unverified').length;
  return (
    <section aria-label="Edge measurements" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">Edge measurements</h2>
        <span className="text-xs text-muted-foreground">{edges.length} edges · {confident} awaiting verification</span>
      </div>
      <p className="text-xs text-muted-foreground">Edges were derived from the elevation data and are estimates until verified. Lengths are sloped (true) feet. Only verified or staff-entered edges feed estimates and materials.</p>
      {edges.length === 0 ? <p className="rounded-md border border-border bg-muted p-3 text-sm">No edges were derived for this measurement. {editable ? 'Add the edges you measure below.' : ''}</p> : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[56rem] text-sm">
            <caption className="sr-only">Roof edges</caption>
            <thead><tr className="border-b border-border text-left text-muted-foreground"><th className="p-2">Edge</th><th>Type</th><th>Length (ft)</th><th>Include</th><th>Status</th><th>Facets</th><th>Note</th><th /></tr></thead>
            <tbody>
              {edges.map((e) => {
                const d = drafts[e.id] ?? {};
                const dirty = d.type !== undefined || d.length !== undefined || d.included !== undefined || d.note !== undefined;
                return (
                  <tr key={e.id} className={`border-b border-border/60 ${e.included ? '' : 'opacity-50'}`}>
                    <td className="p-2 font-medium">{e.id}</td>
                    <td>
                      <select aria-label={`Type of ${e.id}`} className="h-9 rounded-md border border-border bg-card px-1 text-sm" disabled={!editable} value={d.type ?? e.type} onChange={(ev) => set(e.id, { type: ev.target.value as EdgeType })}>
                        {EDGE_TYPES.map((t) => <option key={t} value={t}>{EDGE_LABEL[t]}</option>)}
                      </select>
                    </td>
                    <td><Input aria-label={`Length of ${e.id}`} type="number" step="0.1" min={0} className="h-9 w-24" disabled={!editable} placeholder={e.lengthFt === null ? 'not stated' : ''} value={d.length ?? (e.lengthFt ?? '')} onChange={(ev) => set(e.id, { length: ev.target.value })} /></td>
                    <td><input type="checkbox" aria-label={`Include ${e.id}`} disabled={!editable} checked={d.included ?? e.included} onChange={(ev) => set(e.id, { included: ev.target.checked })} /></td>
                    <td><StatusBadge status={e.verification === 'verified' ? 'confirmed' : e.verification === 'needs_verification' ? 'pending' : 'draft'} className="mr-1" /><span className="text-xs">{statusText(e)}</span></td>
                    <td className="text-xs text-muted-foreground">{e.facetIds.join(', ') || '—'}</td>
                    <td><Input aria-label={`Note for ${e.id}`} className="h-9 min-w-40" disabled={!editable} value={d.note ?? e.note} onChange={(ev) => set(e.id, { note: ev.target.value })} /></td>
                    <td className="whitespace-nowrap p-2 text-right">
                      {editable && dirty ? <Button type="button" size="sm" variant="outline" className="mr-1" onClick={() => void save(e)}>Save</Button> : null}
                      {editable && canVerify && e.verification !== 'verified' && (e.lengthFt !== null || (d.length ?? '') !== '') ? <Button type="button" size="sm" onClick={() => void save(e, true)}>Verify</Button> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {editable ? (
        <div className="space-y-2 rounded-lg border border-border bg-card p-3">
          <Input aria-label="Reason for edge changes" placeholder="Reason for the change (required), e.g. tape measured on site" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex flex-wrap items-end gap-2">
            {canVerify ? <Button type="button" variant="outline" disabled={confident === 0 || mut.verifyEdges.isPending} onClick={() => void verifyConfident()}>Verify all confident edges</Button> : null}
            <span className="mx-2 text-xs text-muted-foreground">or add an edge:</span>
            <select aria-label="New edge type" className="h-10 rounded-md border border-border bg-card px-2 text-sm" value={adding.type} onChange={(e) => setAdding({ ...adding, type: e.target.value as EdgeType })}>{EDGE_TYPES.map((t) => <option key={t} value={t}>{EDGE_LABEL[t]}</option>)}</select>
            <Input aria-label="New edge length (ft)" type="number" step="0.1" min={0} placeholder="ft" className="h-10 w-24" value={adding.length} onChange={(e) => setAdding({ ...adding, length: e.target.value })} />
            <Input aria-label="New edge note" placeholder="Note" className="h-10 w-48" value={adding.note} onChange={(e) => setAdding({ ...adding, note: e.target.value })} />
            <Button type="button" variant="outline" disabled={adding.length === '' || mut.addEdge.isPending} onClick={() => void add()}>Add edge</Button>
          </div>
          <p className="text-xs text-muted-foreground">Enter 0 for a type that does not exist on this roof (for example valleys), so materials can be calculated.</p>
        </div>
      ) : null}
      {msg ? <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'text-sm text-success' : 'text-sm text-danger'}>{msg.text}</p> : null}
    </section>
  );
}
