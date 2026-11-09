import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FormRenderer } from '@/components/forms/FormRenderer';
import { PageHeader } from '@/components/shared/PageHeader';
import { ErrorState, LoadingState } from '@/components/shared/StatePanel';
import { Button } from '@/components/ui/button';
import { allFields, defaultAnswers, validateAnswers, type Answers, type Issue } from '@/lib/form-engine';
import { submitIntake, useTemplate, useTemplates, type IntakeResult } from '@/modules/forms/api';
import { newClientId } from '@/modules/offline/store';
import { useStaffDirectory } from '@/modules/users/api';
import { useAuthStore } from '@/stores/auth-store';
import { ApiError } from '@/types/api';

export function IntakePage(): React.ReactElement {
  const list = useTemplates('intake');
  const intake = list.data?.find((t) => t.key === 'customer_intake');
  const tpl = useTemplate(intake?.id);
  const staff = useStaffDirectory();
  const me = useAuthStore((s) => s.user);
  const [answers, setAnswers] = useState<Answers | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<Array<{ path: string; message: string }>>([]);
  const [result, setResult] = useState<IntakeResult | null>(null);
  const [busy, setBusy] = useState(false);
  // One id per intake attempt: a double tap or a retry after a lost response cannot create two customers.
  const clientId = useMemo(() => newClientId(), []);

  if (list.isLoading || tpl.isLoading) return <LoadingState />;
  if (!intake || !tpl.data) {
    return <ErrorState message="The Customer intake form is not set up. An administrator can install the default forms under Form templates." />;
  }
  if (tpl.data.publishedVersion < 1) return <ErrorState message="The Customer intake form has not been published yet." />;
  const def = tpl.data.definition;
  const current = answers ?? { ...defaultAnswers(def), ...(me?.role === 'salesperson' ? { assigned_rep: me.id } : {}) };

  if (result) {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <PageHeader title="Intake saved" description="The customer, property and lead were created from this form." />
        <div className="flex flex-wrap gap-2">
          <Button asChild><Link to={`/app/customers/${result.customerId}`}>Open customer</Link></Button>
          <Button asChild variant="outline"><Link to={`/app/appointments/new?customerId=${result.customerId}&propertyId=${result.propertyId}`}>Schedule inspection</Link></Button>
          <Button asChild variant="outline"><Link to={`/app/leads/${result.leadId}`}>Open lead</Link></Button>
          <Button type="button" variant="outline" onClick={() => window.location.reload()}>New intake</Button>
        </div>
      </div>
    );
  }

  async function submit(force = false): Promise<void> {
    const found = validateAnswers(def, current, { mode: 'complete' });
    setIssues(found);
    if (found.length) return setMessage('Some required answers are missing.');
    setBusy(true);
    setMessage(null);
    setDuplicates([]);
    try {
      setResult(await submitIntake({ clientId, answers: current, force }));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'DUPLICATE_FOUND') {
        setDuplicates(e.details ?? []);
        setMessage('A matching customer or lead may already exist. Review before creating another.');
      } else if (e instanceof ApiError && e.details?.length) {
        setIssues(e.details.map((d) => ({ fieldId: d.path, message: d.message })));
        setMessage(e.message);
      } else {
        setMessage(e instanceof Error ? e.message : 'Could not save the intake.');
      }
    } finally {
      setBusy(false);
    }
  }

  const repPicker = (value: unknown, set: (v: unknown) => void): React.ReactNode => (
    <select aria-label="Assigned representative" className="h-12 w-full rounded-md border border-border bg-card px-3 text-base" disabled={me?.role === 'salesperson'} value={(value as string) ?? ''} onChange={(e) => set(e.target.value || undefined)}>
      <option value="">Select a representative…</option>
      {staff.data?.data.filter((s) => s.role === 'salesperson').map((s) => <option key={s.id} value={s.id}>{s.firstName} {s.lastName}</option>)}
    </select>
  );

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Customer intake" description="Capture a new customer, their property and how they want to be contacted. Consent is recorded exactly as asked." />
      <FormRenderer definition={def} answers={current} onChange={setAnswers} photos={[]} onAddPhoto={() => undefined} onRemovePhoto={() => undefined} issues={issues} overrides={{ assigned_rep: repPicker }} />
      {message ? <p role="alert" className="mt-4 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{message}</p> : null}
      {issues.length > 0 ? (
        <ul className="mt-2 list-disc pl-5 text-sm text-danger">{issues.map((i) => <li key={i.fieldId}>{allFields(def).find((f) => f.id === i.fieldId)?.label ?? i.fieldId}: {i.message}</li>)}</ul>
      ) : null}
      {duplicates.length > 0 ? (
        <div className="mt-3 rounded-md border border-warning bg-warning/15 p-3 text-sm">
          <ul className="mb-2 list-disc pl-5">{duplicates.map((d) => <li key={d.path}>{d.message}</li>)}</ul>
          <Button type="button" variant="outline" disabled={busy} onClick={() => void submit(true)}>Create anyway</Button>
        </div>
      ) : null}
      <div className="sticky bottom-0 mt-6 flex gap-2 border-t border-border bg-background py-3">
        <Button type="button" className="h-12" disabled={busy} onClick={() => void submit(false)}>{busy ? 'Saving…' : 'Save intake'}</Button>
      </div>
    </div>
  );
}
