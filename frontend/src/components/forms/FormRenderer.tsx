import { Camera, MapPin, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import {
  CONDITION_RATINGS,
  CONDITION_RATING_LABELS,
  MEASUREMENT_UNITS,
  computeDerived,
  isFieldVisible,
  isSectionVisible,
  progress,
  stripHidden,
  type Answers,
  type ConditionRating,
  type FormDefinition,
  type FormField,
  type Issue,
} from '@/lib/form-engine';
import type { LocalPhoto } from '@/modules/offline/store';

export type PhotoInput = { id?: string; fieldId: string; blob: Blob; filename: string; mimeType: string; isSignature?: boolean; gps?: { lat: number; lng: number } };

type Props = {
  definition: FormDefinition;
  answers: Answers;
  onChange: (next: Answers) => void;
  /** Photos/signatures captured on this device (queued for upload) per submission. */
  photos: LocalPhoto[];
  /** Photos already stored on the server, per field. */
  serverPhotoCounts?: Record<string, number>;
  onAddPhoto: (p: PhotoInput) => Promise<void> | void;
  onRemovePhoto: (id: string) => Promise<void> | void;
  issues?: Issue[];
  readOnly?: boolean;
  /** Replaces the text input for specific fields (e.g. `assigned_rep` becomes a picker). */
  overrides?: Record<string, (value: unknown, set: (v: unknown) => void) => React.ReactNode>;
};

const inputCls = 'h-12 w-full rounded-md border border-border bg-card px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand';

function Thumb({ photo, onRemove, disabled }: { photo: LocalPhoto; onRemove: () => void; disabled?: boolean }): React.ReactElement {
  const url = useMemo(() => URL.createObjectURL(photo.blob), [photo.blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <div className="relative h-20 w-20 overflow-hidden rounded-md border border-border bg-muted">
      <img src={url} alt={photo.tag || photo.filename} className="h-full w-full object-cover" />
      <span className={cn('absolute bottom-0 left-0 right-0 text-center text-[10px] text-white', photo.status === 'uploaded' ? 'bg-success/90' : photo.status === 'failed' ? 'bg-danger/90' : 'bg-primary/80')}>
        {photo.status === 'uploaded' ? 'Synced' : photo.status === 'failed' ? 'Retry' : 'On device'}
      </span>
      {!disabled && photo.status !== 'uploaded' ? (
        <button type="button" aria-label="Remove photo" onClick={onRemove} className="absolute right-0.5 top-0.5 rounded bg-black/60 p-0.5 text-white">
          <Trash2 className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  );
}

function PhotoButton({ fieldId, label, multiple, accept, onAdd, disabled }: { fieldId: string; label: string; multiple?: boolean; accept?: string; onAdd: Props['onAddPhoto']; disabled?: boolean }): React.ReactElement {
  const ref = useRef<HTMLInputElement>(null);
  async function pick(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    // Optional GPS: never blocks capture when permission is denied or unavailable.
    const gps = await new Promise<{ lat: number; lng: number } | undefined>((resolve) => {
      if (!('geolocation' in navigator)) return resolve(undefined);
      navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }), () => resolve(undefined), { timeout: 2500, maximumAge: 60_000 });
    });
    for (const f of files) await onAdd({ fieldId, blob: f, filename: f.name, mimeType: f.type || 'image/jpeg', gps });
  }
  return (
    <>
      <input ref={ref} type="file" accept={accept ?? 'image/*'} capture={accept ? undefined : 'environment'} multiple={multiple} className="sr-only" aria-label={label} onChange={(e) => void pick(e)} />
      <Button type="button" variant="outline" disabled={disabled} onClick={() => ref.current?.click()} className="h-12">
        <Camera className="h-5 w-5" aria-hidden /> {label}
      </Button>
    </>
  );
}

function SignaturePad({ field, value, set, onAdd, photos, readOnly }: { field: FormField; value: unknown; set: (v: unknown) => void; onAdd: Props['onAddPhoto']; photos: LocalPhoto[]; readOnly?: boolean }): React.ReactElement {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [name, setName] = useState((value as { signerName?: string } | undefined)?.signerName ?? '');
  const [dirty, setDirty] = useState(false);
  const signed = value as { localFileId?: string; fileId?: string; signedAt?: string } | undefined;
  const pos = (e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * e.currentTarget.width, y: ((e.clientY - r.top) / r.height) * e.currentTarget.height };
  };
  function start(e: React.PointerEvent<HTMLCanvasElement>): void {
    if (readOnly) return;
    drawing.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    const ctx = e.currentTarget.getContext('2d');
    const p = pos(e);
    ctx?.beginPath();
    ctx?.moveTo(p.x, p.y);
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>): void {
    if (!drawing.current) return;
    const ctx = e.currentTarget.getContext('2d');
    if (!ctx) return;
    const p = pos(e);
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#303030';
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    setDirty(true);
  }
  function clear(): void {
    const c = canvas.current;
    c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
    setDirty(false);
  }
  async function save(): Promise<void> {
    const c = canvas.current;
    if (!c) return;
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
    if (!blob) return;
    // Replace any previous local signature image for this field.
    const id = crypto.randomUUID();
    await onAdd({ id, fieldId: field.id, blob, filename: 'signature.png', mimeType: 'image/png', isSignature: true });
    set({ localFileId: id, signedAt: new Date().toISOString(), signerName: name.trim() });
  }
  const existing = photos.find((p) => p.fieldId === field.id && p.isSignature);
  return (
    <div className="space-y-2">
      {signed?.signedAt ? (
        <p className="rounded-md bg-success/10 p-2 text-sm text-success">Signed {new Date(signed.signedAt).toLocaleString('en-US')} {(value as { signerName?: string }).signerName ? `by ${(value as { signerName?: string }).signerName}` : ''}{existing?.status === 'uploaded' ? ' · synced' : ' · saved on this device'}</p>
      ) : null}
      {!readOnly ? (
        <>
          <canvas ref={canvas} width={600} height={200} onPointerDown={start} onPointerMove={move} onPointerUp={() => { drawing.current = false; }} aria-label={`${field.label} signature pad`} className="w-full touch-none rounded-md border-2 border-dashed border-border bg-white" />
          <div className="flex flex-wrap gap-2">
            <Input aria-label="Printed name" placeholder="Printed name" value={name} onChange={(e) => setName(e.target.value)} className="h-12 max-w-xs text-base" />
            <Button type="button" variant="outline" className="h-12" onClick={clear}>Clear</Button>
            <Button type="button" className="h-12" disabled={!dirty || (field.signerNameRequired && !name.trim())} onClick={() => void save()}>Save signature</Button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function FieldInput({ field, value, set, props }: { field: FormField; value: unknown; set: (v: unknown) => void; props: Props }): React.ReactElement {
  const ro = props.readOnly;
  const override = props.overrides?.[field.id];
  if (override) return <>{override(value, set)}</>;
  const fieldPhotos = props.photos.filter((p) => p.fieldId === field.id && !p.isSignature);
  switch (field.type) {
    case 'text':
      return <input id={field.id} className={inputCls} disabled={ro} value={(value as string) ?? ''} onChange={(e) => set(e.target.value)} inputMode={field.id.includes('phone') ? 'tel' : field.id.includes('email') ? 'email' : undefined} />;
    case 'long_text':
      return <textarea id={field.id} className="min-h-24 w-full rounded-md border border-border bg-card p-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand" disabled={ro} value={(value as string) ?? ''} onChange={(e) => set(e.target.value)} />;
    case 'number':
      return <input id={field.id} className={inputCls} type="number" inputMode="decimal" disabled={ro || Boolean(field.computed)} value={(value as number | undefined) ?? ''} onChange={(e) => set(e.target.value === '' ? undefined : Number(e.target.value))} />;
    case 'currency':
      return <input id={field.id} className={inputCls} inputMode="decimal" disabled={ro} placeholder="0.00" value={value === undefined ? '' : ((value as number) / 100).toFixed(2)} onChange={(e) => set(e.target.value === '' ? undefined : Math.round(Number(e.target.value) * 100))} />;
    case 'date':
      return <input id={field.id} className={inputCls} type="date" disabled={ro} value={(value as string) ?? ''} onChange={(e) => set(e.target.value || undefined)} />;
    case 'datetime':
      return <input id={field.id} className={inputCls} type="datetime-local" disabled={ro} value={value ? String(value).slice(0, 16) : ''} onChange={(e) => set(e.target.value ? new Date(e.target.value).toISOString() : undefined)} />;
    case 'dropdown':
      return (
        <select id={field.id} className={inputCls} disabled={ro} value={(value as string) ?? ''} onChange={(e) => set(e.target.value || undefined)}>
          <option value="">Select…</option>
          {field.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    case 'multiselect': {
      const sel = (value as string[] | undefined) ?? [];
      return (
        <div className="flex flex-wrap gap-2" role="group" aria-label={field.label}>
          {field.options?.map((o) => {
            const on = sel.includes(o.value);
            return (
              <button key={o.value} type="button" disabled={ro} aria-pressed={on} onClick={() => set(on ? sel.filter((x) => x !== o.value) : [...sel, o.value])}
                className={cn('h-11 rounded-full border px-4 text-sm', on ? 'border-brand bg-brand-soft font-medium text-brand' : 'border-border bg-card')}>{o.label}</button>
            );
          })}
        </div>
      );
    }
    case 'yes_no':
      return (
        <div className="flex gap-2" role="group" aria-label={field.label}>
          {[true, false].map((b) => (
            <button key={String(b)} type="button" disabled={ro} aria-pressed={value === b} onClick={() => set(value === b ? undefined : b)}
              className={cn('h-12 min-w-24 rounded-md border text-base', value === b ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card')}>{b ? 'Yes' : 'No'}</button>
          ))}
        </div>
      );
    case 'condition_rating': {
      const v = (value as { rating?: ConditionRating; notes?: string; measurement?: { value: number; unit: string } } | undefined) ?? {};
      return (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5" role="group" aria-label={`${field.label} condition`}>
            {CONDITION_RATINGS.map((r) => (
              <button key={r} type="button" disabled={ro} aria-pressed={v.rating === r} onClick={() => set({ ...v, rating: r })}
                className={cn('h-12 rounded-md border text-sm', v.rating === r ? (r === 'good' ? 'border-success bg-success/10 font-semibold text-success' : r === 'fair' ? 'border-warning bg-warning/15 font-semibold' : r === 'n_a' ? 'border-grey bg-muted font-semibold' : 'border-danger bg-danger/10 font-semibold text-danger') : 'border-border bg-card')}>{CONDITION_RATING_LABELS[r]}</button>
            ))}
          </div>
          {v.rating && v.rating !== 'n_a' ? (
            <div className="space-y-2">
              <textarea aria-label={`${field.label} notes`} placeholder="Notes" className="min-h-16 w-full rounded-md border border-border bg-card p-3 text-base" disabled={ro} value={v.notes ?? ''} onChange={(e) => set({ ...v, notes: e.target.value })} />
              {field.withMeasurement ? (
                <div className="flex gap-2">
                  <input aria-label={`${field.label} measurement`} className={inputCls} type="number" inputMode="decimal" disabled={ro} value={v.measurement?.value ?? ''} onChange={(e) => set({ ...v, measurement: e.target.value === '' ? undefined : { value: Number(e.target.value), unit: v.measurement?.unit ?? 'EA' } })} />
                  <select aria-label="Unit" className={`${inputCls} w-28`} disabled={ro} value={v.measurement?.unit ?? 'EA'} onChange={(e) => set({ ...v, measurement: { value: v.measurement?.value ?? 0, unit: e.target.value } })}>
                    {MEASUREMENT_UNITS.map((u) => <option key={u}>{u}</option>)}
                  </select>
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                {!ro ? <PhotoButton fieldId={field.id} label="Add photo" multiple onAdd={props.onAddPhoto} /> : null}
                {fieldPhotos.map((p) => <Thumb key={p.id} photo={p} disabled={ro} onRemove={() => void props.onRemovePhoto(p.id)} />)}
              </div>
            </div>
          ) : null}
        </div>
      );
    }
    case 'measurement': {
      const m = value as { value: number; unit: string } | undefined;
      const units = field.units && field.units.length > 0 ? field.units : [...MEASUREMENT_UNITS];
      return (
        <div className="flex gap-2">
          <input id={field.id} className={inputCls} type="number" inputMode="decimal" disabled={ro || Boolean(field.computed)} value={m?.value ?? ''} onChange={(e) => set(e.target.value === '' ? undefined : { value: Number(e.target.value), unit: m?.unit ?? units[0] })} />
          <select aria-label={`${field.label} unit`} className={`${inputCls} w-28`} disabled={ro || Boolean(field.computed)} value={m?.unit ?? units[0]} onChange={(e) => set({ value: m?.value ?? 0, unit: e.target.value })}>
            {units.map((u) => <option key={u}>{u}</option>)}
          </select>
        </div>
      );
    }
    case 'photos':
    case 'file': {
      const count = fieldPhotos.length + (props.serverPhotoCounts?.[field.id] ?? 0);
      const need = field.minPhotos ?? (field.required ? 1 : 0);
      return (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {!ro ? <PhotoButton fieldId={field.id} label={field.type === 'photos' ? 'Take / add photos' : 'Attach file'} multiple accept={field.type === 'file' ? 'image/jpeg,image/png,image/webp,application/pdf,text/plain' : undefined} onAdd={props.onAddPhoto} /> : null}
            <span className={cn('text-sm', need > 0 && count < need ? 'text-danger' : 'text-muted-foreground')}>{count} added{need > 0 ? ` · ${need} required` : ''}</span>
          </div>
          <div className="flex flex-wrap gap-2">{fieldPhotos.map((p) => <Thumb key={p.id} photo={p} disabled={ro} onRemove={() => void props.onRemovePhoto(p.id)} />)}</div>
        </div>
      );
    }
    case 'signature':
      return <SignaturePad field={field} value={value} set={set} onAdd={props.onAddPhoto} photos={props.photos} readOnly={ro} />;
    case 'address': {
      const a = (value as { line1?: string; city?: string; state?: string; zip?: string; lat?: number; lng?: number } | undefined) ?? {};
      const upd = (k: string, v: string): void => set({ ...a, [k]: v });
      return (
        <div className="grid gap-2 sm:grid-cols-4">
          <input aria-label={`${field.label} street`} placeholder="Street address" className={`${inputCls} sm:col-span-4`} disabled={ro} value={a.line1 ?? ''} onChange={(e) => upd('line1', e.target.value)} />
          <input aria-label={`${field.label} city`} placeholder="City" className={`${inputCls} sm:col-span-2`} disabled={ro} value={a.city ?? ''} onChange={(e) => upd('city', e.target.value)} />
          <input aria-label={`${field.label} state`} placeholder="State" className={inputCls} disabled={ro} value={a.state ?? 'TX'} onChange={(e) => upd('state', e.target.value)} />
          <input aria-label={`${field.label} ZIP`} placeholder="ZIP" inputMode="numeric" className={inputCls} disabled={ro} value={a.zip ?? ''} onChange={(e) => upd('zip', e.target.value)} />
          {!ro ? (
            <div className="flex flex-wrap items-center gap-2 sm:col-span-4">
              <Button type="button" variant="outline" className="h-11" onClick={() => navigator.geolocation?.getCurrentPosition((p) => set({ ...a, lat: Number(p.coords.latitude.toFixed(6)), lng: Number(p.coords.longitude.toFixed(6)) }), () => undefined, { timeout: 5000 })}>
                <MapPin className="h-4 w-4" aria-hidden /> Drop pin at my location
              </Button>
              {a.lat !== undefined && a.lng !== undefined ? (
                <a className="text-sm hover:underline" target="_blank" rel="noreferrer noopener" href={`https://www.openstreetmap.org/?mlat=${a.lat}&mlon=${a.lng}#map=18/${a.lat}/${a.lng}`}>Pin: {a.lat}, {a.lng}</a>
              ) : <span className="text-sm text-muted-foreground">No map pin yet (GPS is optional).</span>}
            </div>
          ) : null}
        </div>
      );
    }
  }
}

/** Sectioned form with progress. Every change is reported to the parent, which persists it locally first. */
export function FormRenderer(props: Props): React.ReactElement {
  const { definition, answers, onChange, issues = [] } = props;
  const sections = definition.sections.filter((s) => isSectionVisible(s, answers));
  const [index, setIndex] = useState(0);
  const current = sections[Math.min(index, sections.length - 1)];
  const photoCounts = useMemo(() => {
    const c: Record<string, number> = { ...(props.serverPhotoCounts ?? {}) };
    for (const p of props.photos) if (!p.isSignature) c[p.fieldId] = (c[p.fieldId] ?? 0) + 1;
    return c;
  }, [props.photos, props.serverPhotoCounts]);
  const prog = progress(definition, answers, photoCounts);
  const issueFor = (id: string): string | undefined => issues.find((i) => i.fieldId === id)?.message;

  function setAnswer(id: string, v: unknown): void {
    const next = { ...answers };
    if (v === undefined || v === '') delete next[id];
    else next[id] = v;
    onChange(stripHidden(definition, computeDerived(definition, next)));
  }

  if (!current) return <p className="text-sm text-muted-foreground">This form has no visible sections.</p>;
  const pct = prog.total === 0 ? 100 : Math.round((prog.done / prog.total) * 100);

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1 flex justify-between text-xs text-muted-foreground"><span>{prog.done} of {prog.total} required items</span><span>{pct}%</span></div>
        <div className="h-2 rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Form progress"><div className="h-2 rounded-full bg-brand transition-all" style={{ width: `${pct}%` }} /></div>
      </div>
      <nav aria-label="Form sections" className="flex gap-1 overflow-x-auto pb-1">
        {sections.map((s, i) => {
          const hasIssue = s.fields.some((f) => issueFor(f.id));
          return (
            <button key={s.id} type="button" onClick={() => setIndex(i)} aria-current={i === index ? 'step' : undefined}
              className={cn('shrink-0 rounded-full border px-3 py-1.5 text-sm', i === index ? 'border-primary bg-primary text-primary-foreground' : hasIssue ? 'border-danger text-danger' : 'border-border bg-card')}>{s.title}</button>
          );
        })}
      </nav>
      <section aria-label={current.title} className="space-y-5 rounded-lg border border-border bg-card p-4 shadow-sm">
        <div>
          <h2 className="text-base font-semibold">{current.title}</h2>
          {current.description ? <p className="text-sm text-muted-foreground">{current.description}</p> : null}
        </div>
        {current.fields.filter((f) => isFieldVisible(current, f, answers)).map((f) => (
          <div key={f.id} className="space-y-1.5">
            <label htmlFor={f.id} className="block text-sm font-medium">{f.label}{f.required ? <span className="text-danger"> *</span> : null}</label>
            {f.helpText ? <p className="text-xs text-muted-foreground">{f.helpText}</p> : null}
            <FieldInput field={f} value={answers[f.id]} set={(v) => setAnswer(f.id, v)} props={props} />
            {issueFor(f.id) ? <p role="alert" className="text-sm text-danger">{issueFor(f.id)}</p> : null}
          </div>
        ))}
      </section>
      <div className="flex justify-between">
        <Button type="button" variant="outline" className="h-12" disabled={index === 0} onClick={() => setIndex(index - 1)}>Back</Button>
        <Button type="button" className="h-12" disabled={index >= sections.length - 1} onClick={() => setIndex(index + 1)}>Next section</Button>
      </div>
    </div>
  );
}
