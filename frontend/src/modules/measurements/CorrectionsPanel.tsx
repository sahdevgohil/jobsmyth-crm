import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useHasPermission } from '@/lib/permissions';
import { ApiError } from '@/types/api';
import { useSolarMutations } from './solarApi';
import type { Measurement } from './types';

const SOURCE_LABEL: Record<string, string> = { google: 'Google Solar', calculated: 'Calculated', manual: 'Manually entered', derived: 'Automatically derived' };
const FIELD_LABEL: Record<string, string> = {
  totalArea: 'Total roof area (sq ft)', facets: 'Roof segments', pitch: 'Predominant pitch (X/12)', ridge: 'Ridge (ft)', hip: 'Hip (ft)', valley: 'Valley (ft)', eave: 'Eave (ft)', rake: 'Rake (ft)',
  pipeBoots: 'Pipe boots', vents: 'Vents', skylights: 'Skylights', chimneys: 'Chimneys', roofLayers: 'Roof layers', chimneyDetails: 'Chimney details', extraTearOff: 'Additional tear-off',
};
const NUMERIC = new Set(['totalArea', 'facets', 'ridge', 'hip', 'valley', 'eave', 'rake', 'pipeBoots', 'vents', 'skylights', 'chimneys', 'roofLayers']);
const EDITABLE = ['totalArea', 'facets', 'pitch', 'ridge', 'hip', 'valley', 'eave', 'rake', 'pipeBoots', 'vents', 'skylights', 'chimneys', 'roofLayers', 'extraTearOff', 'chimneyDetails'];

const originLabel = (m: Measurement, f: string): string => {
  const src = m.solar?.fieldSources[f];
  if (m.solar?.verified[f]) return src === 'manual' ? 'Field verified (entered by staff)' : 'Field verified';
  return SOURCE_LABEL[src ?? ''] ?? (src ?? 'Not recorded');
};
const currentValue = (m: Measurement, f: string): string => {
  const raw = (m as unknown as Record<string, unknown>)[f] ?? m.solar?.counts[f];
  return raw === null || raw === undefined ? '' : String(raw);
};

/** Area, pitch, edge totals and feature counts. Every change keeps the old value, who changed it, when and why. */
export function CorrectionsPanel({ m }: { m: Measurement }): React.ReactElement | null {
  const mut = useSolarMutations();
  const canEdit = useHasPermission('measurements:update') && !m.solar?.supersededById;
  const canVerify = useHasPermission('measurements:verify');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [verify, setVerify] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!m.solar) return null;
  const s = m.solar;

  async function save(): Promise<void> {
    setMsg(null);
    const changes: Record<string, number | string | null> = {};
    for (const [f, v] of Object.entries(draft)) {
      if (v === currentValue(m, f)) continue;
      changes[f] = v.trim() === '' ? null : NUMERIC.has(f) ? Number(v) : v.trim();
    }
    const verifyMap = Object.fromEntries(Object.entries(verify).filter(([, on]) => on));
    if (Object.keys(changes).length === 0 && Object.keys(verifyMap).length === 0) return setMsg({ ok: false, text: 'Change a value or tick a field to verify.' });
    try {
      await mut.correct.mutateAsync({ id: m.id, changes, verify: verifyMap, reason });
      setDraft({}); setVerify({}); setReason('');
      setMsg({ ok: true, text: 'Saved. The original provider values are kept.' });
    } catch (e) { setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Could not save.' }); }
  }

  return (
    <div className="space-y-4">
      {canEdit ? (
        <section aria-label="Manual corrections" className="space-y-3 rounded-lg border border-border bg-card p-4">
          <h2 className="text-base font-semibold">Corrections and verification</h2>
          <p className="text-xs text-muted-foreground">Changes are logged with the old value, your name, the time and your reason. The original provider data is never overwritten.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {EDITABLE.map((f) => (
              <div key={f} className="flex items-center gap-2">
                <label className="min-w-0 flex-1 text-sm">{FIELD_LABEL[f]}
                  <span className="block text-xs text-muted-foreground">{originLabel(m, f)}</span>
                  <Input aria-label={FIELD_LABEL[f]} className="h-10" type={NUMERIC.has(f) ? 'number' : 'text'} step="any" inputMode={NUMERIC.has(f) ? 'decimal' : undefined} value={draft[f] ?? currentValue(m, f)} onChange={(e) => setDraft({ ...draft, [f]: e.target.value })} />
                </label>
                {canVerify ? <label className="flex items-center gap-1 text-xs"><input type="checkbox" aria-label={`Verify ${FIELD_LABEL[f]}`} checked={verify[f] ?? Boolean(s.verified[f])} disabled={Boolean(s.verified[f])} onChange={(e) => setVerify({ ...verify, [f]: e.target.checked })} /> Verified</label> : null}
              </div>
            ))}
          </div>
          <Input aria-label="Reason for the change" placeholder="Reason (required), e.g. measured on site" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button type="button" disabled={reason.trim().length < 3 || mut.correct.isPending} onClick={() => void save()}>Save corrections</Button>
          {msg ? <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'text-sm text-success' : 'text-sm text-danger'}>{msg.text}</p> : null}
        </section>
      ) : null}
      {s.corrections.length > 0 ? (
        <section aria-label="Change history" className="space-y-2">
          <h2 className="text-base font-semibold">Change history</h2>
          <ul className="divide-y divide-border rounded-lg border border-border bg-card text-sm">
            {[...s.corrections].reverse().map((c, i) => (
              <li key={i} className="px-3 py-2"><strong>{FIELD_LABEL[c.field] ?? c.field}</strong>: {String(c.original ?? '—')} → {String(c.updated ?? '—')}
                <span className="block text-xs text-muted-foreground">{new Date(c.at).toLocaleString('en-US')} · {c.reason}</span></li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
