import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { FormField, selectClass } from '@/components/shared/FormField';
import { ListPage } from '@/components/shared/ListPage';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCreateUser, useDeactivateUser } from '@/modules/users/api';
import { createUserSchema, type CreateUserValues } from '@/modules/users/schemas';
import { ApiError } from '@/types/api';

type U = { id: string; email: string; firstName: string; lastName: string; role: string; isActive: boolean; receivesLeads: boolean; lastLoginAt?: string | null };

const EMPTY: CreateUserValues = { email: '', firstName: '', lastName: '', phone: '', role: 'salesperson', temporaryPassword: '', receivesLeads: true };

function CreateUser({ onDone }: { onDone: () => void }): React.ReactElement {
  const createUser = useCreateUser();
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<CreateUserValues>({ resolver: zodResolver(createUserSchema), defaultValues: EMPTY });
  const err = form.formState.errors;

  async function onCreate(values: CreateUserValues): Promise<void> {
    setFormError(null);
    setInviteToken(null);
    try {
      const res = await createUser.mutateAsync(values);
      setInviteToken(res.data.inviteToken);
      form.reset(EMPTY);
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Unable to create user.');
    }
  }

  return (
    <form className="mb-6 grid gap-3 rounded-lg border border-border bg-card p-4 shadow-sm sm:grid-cols-2" onSubmit={(e) => void form.handleSubmit(onCreate)(e)}>
      <FormField label="Email" htmlFor="u-email" error={err.email?.message}><Input id="u-email" {...form.register('email')} /></FormField>
      <FormField label="Role" htmlFor="u-role">
        <select id="u-role" className={selectClass} {...form.register('role')}>
          <option value="salesperson">Salesperson</option>
          <option value="admin">Admin</option>
        </select>
      </FormField>
      <FormField label="First name" htmlFor="u-first" error={err.firstName?.message}><Input id="u-first" {...form.register('firstName')} /></FormField>
      <FormField label="Last name" htmlFor="u-last" error={err.lastName?.message}><Input id="u-last" {...form.register('lastName')} /></FormField>
      <FormField label="Temporary password" htmlFor="u-pass" hint="At least 12 characters. The user must change it at first sign-in." error={err.temporaryPassword?.message}>
        <Input id="u-pass" type="password" {...form.register('temporaryPassword')} />
      </FormField>
      <label className="flex items-end gap-2 pb-2 text-sm">
        <input type="checkbox" checked={Boolean(form.watch('receivesLeads'))} onChange={(e) => form.setValue('receivesLeads', e.target.checked)} />
        Receives leads
      </label>
      {formError ? <p role="alert" className="text-sm text-danger sm:col-span-2">{formError}</p> : null}
      {inviteToken ? (
        <p className="text-sm text-muted-foreground sm:col-span-2">
          User created. Email delivery is not configured; share this invite token out-of-band if needed: <code className="break-all text-foreground">{inviteToken}</code>
        </p>
      ) : null}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" disabled={createUser.isPending}>Create user</Button>
        <Button type="button" variant="outline" onClick={onDone}>Close</Button>
      </div>
    </form>
  );
}

function Deactivate({ id }: { id: string }): React.ReactElement {
  const deactivate = useDeactivateUser();
  return (
    <button
      type="button"
      className="text-xs text-brand hover:underline"
      disabled={deactivate.isPending}
      onClick={() => { if (window.confirm('Deactivate this user? Their sessions are revoked.')) void deactivate.mutateAsync(id); }}
    >
      Deactivate
    </button>
  );
}

export function UsersPage(): React.ReactElement {
  const [creating, setCreating] = useState(false);
  return (
    <>
      {creating ? <CreateUser onDone={() => setCreating(false)} /> : null}
      <ListPage<U>
        title="Users"
        description="Staff accounts. New users get a temporary password and must change it on first sign-in."
        queryKey="users"
        path="/users"
        filters={[
          { key: 'role', label: 'Role', options: [{ value: 'admin', label: 'Admin' }, { value: 'salesperson', label: 'Salesperson' }] },
          { key: 'isActive', label: 'Status', options: [{ value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }] },
        ]}
        actions={!creating ? <Button onClick={() => setCreating(true)}>New user</Button> : null}
        emptyTitle="No users"
        columns={[
          { key: 'n', header: 'Name', render: (u) => <span>{u.firstName} {u.lastName}<span className="block text-xs font-normal text-muted-foreground">{u.email}</span></span> },
          { key: 'r', header: 'Role', render: (u) => <StatusBadge status={u.role} tone={u.role === 'admin' ? 'info' : 'neutral'} /> },
          { key: 'l', header: 'Receives leads', render: (u) => (u.receivesLeads ? 'Yes' : 'No'), hideOnMobile: true },
          { key: 'll', header: 'Last sign-in', render: (u) => (u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString('en-US') : 'Never'), hideOnMobile: true },
          { key: 's', header: 'Status', render: (u) => <span className="flex items-center gap-2"><StatusBadge status={u.isActive ? 'active' : 'inactive'} />{u.isActive ? <Deactivate id={u.id} /> : null}</span> },
        ]}
      />
    </>
  );
}
