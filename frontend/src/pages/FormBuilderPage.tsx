import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { FormRenderer } from '@/components/forms/FormRenderer';
import { PageHeader } from '@/components/shared/PageHeader';
import { ErrorState, LoadingState } from '@/components/shared/StatePanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FIELD_TYPES, allFields, defaultAnswers, validateDefinition, type Answers, type Condition, type FieldType, type FormDefinition, type FormField, type FormSection } from '@/lib/form-engine';
import { useTemplate, useTemplateMutations, useTemplateVersions } from '@/modules/forms/api';
import { ApiError } from '@/types/api';

const TYPE_LABEL: Record<string, string> = {
  text: 'Short text', long_text: 'Long text', number: 'Number', currency: 'Currency', date: 'Date', datetime: 'Date & time', dropdown: 'Dropdown',
  multiselect: 'Multi-select', yes_no: 'Yes / No', condition_rating: 'Condition rating', measurement: 'Measurement', photos: 'Photos', file: 'File', signature: 'Signature', address: 'Address',
};
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60);
const sel = 'h-9 rounded-md border border-border bg-card px-2 text-sm';
const move = <T,>(a: T[], i: number, d: number): T[] => {
  const j = i + d;
  if (j < 0 || j >= a.length) return a;
  const c = [...a];
  [c[i], c[j]] = [c[j]!, c[i]!];
  return c;
};

function ConditionEditor({ value, fields, onChange }: { value?: Condition; fields: FormField[]; onChange: (c: Condition | undefined) => void }): React.ReactElement {
  if (value && ('all' in value || 'any' in value)) return <p className="text-xs text-muted-foreground">Combined condition (all/any) from the default form: kept as is.</p>;
  const c = value as { field?: string; op?: string; value?: unknown } | undefined;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span>Show only when</span>
      <select aria-label="Condition field" className={sel} value={c?.field ?? ''} onChange={(e) => onChange(e.target.value ? ({ field: e.target.value, op: c?.op ?? 'eq', value: c?.value ?? true } as unknown as Condition) : undefined)}>
        <option value="">(always)</option>
        {fields.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
      </select>
      {c?.field ? (
        <>
          <select aria-label="Condition operator" className={sel} value={c.op ?? 'eq'} onChange={(e) => onChange({ ...(c as object), op: e.target.value } as unknown as Condition)}>
            <option value="eq">is</option><option value="neq">is not</option><option value="includes">includes</option><option value="notEmpty">has an answer</option><option value="empty">is empty</option>
          </select>
          {c.op !== 'notEmpty' && c.op !== 'empty' ? (
            <Input aria-label="Condition value" className="h-9 w-40" value={String(c.value ?? '')} onChange={(e) => {
              const raw = e.target.value;
              onChange({ ...(c as object), value: raw === 'true' ? true : raw === 'false' ? false : raw } as unknown as Condition);
            }} />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function FieldEditor({ field, all, onChange, onRemove, onMove }: { field: FormField; all: FormField[]; onChange: (f: FormField) => void; onRemove: () => void; onMove: (d: number) => void }): React.ReactElement {
  const hasOptions = field.type === 'dropdown' || field.type === 'multiselect';
  return (
    <div className="space-y-2 rounded-md border border-border bg-background p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label="Field label" className="h-9 min-w-48 flex-1" value={field.label} onChange={(e) => onChange({ ...field, label: e.target.value })} />
        <select aria-label="Field type" className={sel} value={field.type} onChange={(e) => onChange({ ...field, type: e.target.value as FieldType })}>
          {FIELD_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t] ?? t}</option>)}
        </select>
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={Boolean(field.required)} onChange={(e) => onChange({ ...field, required: e.target.checked })} /> Required</label>
        <button type="button" aria-label="Move field up" className="rounded p-1.5 hover:bg-muted" onClick={() => onMove(-1)}><ArrowUp className="h-4 w-4" /></button>
        <button type="button" aria-label="Move field down" className="rounded p-1.5 hover:bg-muted" onClick={() => onMove(1)}><ArrowDown className="h-4 w-4" /></button>
        <button type="button" aria-label={`Remove ${field.label}`} className="rounded p-1.5 text-danger hover:bg-muted" onClick={onRemove}><Trash2 className="h-4 w-4" /></button>
      </div>
      <p className="text-xs text-muted-foreground">Field id: <code>{field.id}</code> (fixed once saved, so old answers keep their meaning)</p>
      <Input aria-label="Help text" placeholder="Help text (optional)" className="h-9" value={field.helpText ?? ''} onChange={(e) => onChange({ ...field, helpText: e.target.value || undefined })} />
      {hasOptions ? (
        <textarea aria-label="Options, one per line" placeholder="One option per line" className="min-h-20 w-full rounded-md border border-border bg-card p-2 text-sm"
          value={(field.options ?? []).map((o) => o.label).join('\n')}
          onChange={(e) => onChange({ ...field, options: e.target.value.split('\n').filter((l) => l.trim()).map((l) => ({ label: l.trim(), value: slug(l) || 'option' })) })} />
      ) : null}
      {field.type === 'photos' ? (
        <label className="flex items-center gap-2 text-sm">Minimum photos <Input type="number" min={0} className="h-9 w-20" value={field.minPhotos ?? 0} onChange={(e) => onChange({ ...field, minPhotos: Number(e.target.value) || undefined })} /></label>
      ) : null}
      {field.type === 'number' || field.type === 'currency' ? (
        <div className="flex gap-2 text-sm">
          <label className="flex items-center gap-1">Min <Input type="number" className="h-9 w-24" value={field.min ?? ''} onChange={(e) => onChange({ ...field, min: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
          <label className="flex items-center gap-1">Max <Input type="number" className="h-9 w-24" value={field.max ?? ''} onChange={(e) => onChange({ ...field, max: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
        </div>
      ) : null}
      {field.type === 'text' || field.type === 'long_text' ? (
        <label className="flex items-center gap-1 text-sm">Max length <Input type="number" min={1} className="h-9 w-24" value={field.maxLength ?? ''} onChange={(e) => onChange({ ...field, maxLength: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
      ) : null}
      <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={Boolean(field.sensitive)} onChange={(e) => onChange({ ...field, sensitive: e.target.checked || undefined })} /> Sensitive (hidden from users without access, left out of reports)</label>
      <ConditionEditor value={field.visibleWhen} fields={all.filter((f) => f.id !== field.id)} onChange={(c) => onChange({ ...field, visibleWhen: c })} />
    </div>
  );
}

export function FormBuilderPage(): React.ReactElement {
  const { id } = useParams();
  const q = useTemplate(id);
  const versions = useTemplateVersions(id);
  const m = useTemplateMutations();
  const [def, setDef] = useState<FormDefinition | null>(null);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState<Answers>({});

  useEffect(() => {
    if (q.data) {
      setDef(q.data.definition);
      setName(q.data.name);
    }
  }, [q.data]);

  if (q.isLoading || !def) return q.isError ? <ErrorState message="Could not load this form." /> : <LoadingState />;
  const tpl = q.data!;
  const problems = validateDefinition(def);
  const fieldsAll = allFields(def);
  const setSection = (i: number, s: FormSection): void => setDef({ sections: def.sections.map((x, k) => (k === i ? s : x)) });

  function addField(si: number): void {
    const label = 'New field';
    let n = 1;
    const ids = new Set(fieldsAll.map((f) => f.id));
    while (ids.has(`new_field_${n}`)) n += 1;
    const sec = def!.sections[si]!;
    setSection(si, { ...sec, fields: [...sec.fields, { id: `new_field_${n}`, label, type: 'text' }] });
  }

  async function save(): Promise<boolean> {
    setMsg(null);
    try {
      await m.update.mutateAsync({ id: tpl.id, name, definition: def! });
      setMsg({ ok: true, text: 'Saved as a working draft. Publish to make it available.' });
      return true;
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? `${e.message}${e.details?.length ? ': ' + e.details.map((d) => d.message).join('; ') : ''}` : 'Could not save.' });
      return false;
    }
  }

  async function publish(): Promise<void> {
    if (!(await save())) return;
    try {
      const t = await m.publish.mutateAsync({ id: tpl.id, changeNote: note || undefined });
      setMsg({ ok: true, text: `Published version ${t.publishedVersion}.` });
      setNote('');
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Could not publish.' });
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title={`Edit: ${tpl.name}`} description={`${tpl.publishedVersion > 0 ? `Published v${tpl.publishedVersion}` : 'Not published'}${tpl.hasUnpublishedChanges ? ' · unpublished changes' : ''}. Existing submissions keep the version they were filled with.`} actions={<Button asChild variant="outline"><Link to="/app/forms">All forms</Link></Button>} />
      <Input aria-label="Form name" value={name} onChange={(e) => setName(e.target.value)} className="max-w-md" />

      {def.sections.map((s, si) => (
        <section key={s.id} className="space-y-3 rounded-lg border border-border bg-card p-4" aria-label={s.title}>
          <div className="flex flex-wrap items-center gap-2">
            <Input aria-label="Section title" className="h-9 max-w-sm flex-1 font-medium" value={s.title} onChange={(e) => setSection(si, { ...s, title: e.target.value })} />
            <button type="button" aria-label="Move section up" className="rounded p-1.5 hover:bg-muted" onClick={() => setDef({ sections: move(def.sections, si, -1) })}><ArrowUp className="h-4 w-4" /></button>
            <button type="button" aria-label="Move section down" className="rounded p-1.5 hover:bg-muted" onClick={() => setDef({ sections: move(def.sections, si, 1) })}><ArrowDown className="h-4 w-4" /></button>
            <button type="button" aria-label={`Remove section ${s.title}`} className="rounded p-1.5 text-danger hover:bg-muted" onClick={() => setDef({ sections: def.sections.filter((_, k) => k !== si) })}><Trash2 className="h-4 w-4" /></button>
          </div>
          <ConditionEditor value={s.visibleWhen} fields={fieldsAll} onChange={(c) => setSection(si, { ...s, visibleWhen: c })} />
          {s.fields.map((f, fi) => (
            <FieldEditor key={f.id} field={f} all={fieldsAll}
              onChange={(nf) => setSection(si, { ...s, fields: s.fields.map((x, k) => (k === fi ? nf : x)) })}
              onRemove={() => setSection(si, { ...s, fields: s.fields.filter((_, k) => k !== fi) })}
              onMove={(d) => setSection(si, { ...s, fields: move(s.fields, fi, d) })} />
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => addField(si)}><Plus className="h-4 w-4" aria-hidden /> Add field</Button>
        </section>
      ))}
      <Button type="button" variant="outline" onClick={() => {
        let n = def.sections.length + 1;
        while (def.sections.some((s) => s.id === `section_${n}`)) n += 1;
        setDef({ sections: [...def.sections, { id: `section_${n}`, title: 'New section', fields: [] }] });
      }}><Plus className="h-4 w-4" aria-hidden /> Add section</Button>

      {problems.length > 0 ? <ul role="alert" className="list-disc rounded-md border border-danger/40 bg-danger/10 p-3 pl-8 text-sm text-danger">{problems.map((p) => <li key={p}>{p}</li>)}</ul> : null}
      {msg ? <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'text-sm text-success' : 'text-sm text-danger'}>{msg.text}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" disabled={m.update.isPending || problems.length > 0} onClick={() => void save()}>Save draft</Button>
        <Input aria-label="Change note" placeholder="What changed? (optional)" className="max-w-xs" value={note} onChange={(e) => setNote(e.target.value)} />
        <Button type="button" disabled={m.publish.isPending || problems.length > 0} onClick={() => void publish()}>Publish new version</Button>
        <Button type="button" variant="outline" onClick={() => void m.update.mutateAsync({ id: tpl.id, isActive: !tpl.isActive })}>{tpl.isActive ? 'Deactivate' : 'Activate'}</Button>
      </div>

      <section aria-labelledby="ver-h" className="rounded-lg border border-border bg-card p-4">
        <h2 id="ver-h" className="mb-2 text-base font-semibold">Version history</h2>
        {versions.data?.length ? (
          <ul className="divide-y divide-border text-sm">{versions.data.map((v) => <li key={v.version} className="py-2">v{v.version} · {new Date(v.publishedAt).toLocaleString('en-US')}{v.changeNote ? ` · ${v.changeNote}` : ''}</li>)}</ul>
        ) : <p className="text-sm text-muted-foreground">Nothing published yet.</p>}
      </section>

      <section aria-labelledby="prev-h">
        <h2 id="prev-h" className="mb-2 text-base font-semibold">Preview</h2>
        {problems.length === 0 ? <FormRenderer definition={def} answers={{ ...defaultAnswers(def), ...preview }} onChange={setPreview} photos={[]} onAddPhoto={() => undefined} onRemovePhoto={() => undefined} /> : <p className="text-sm text-muted-foreground">Fix the problems above to preview.</p>}
      </section>
    </div>
  );
}
