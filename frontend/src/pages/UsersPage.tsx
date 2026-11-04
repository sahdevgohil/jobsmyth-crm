import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/StatePanel';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCreateUser, useDeactivateUser, useUsers } from '@/modules/users/api';
import { createUserSchema, type CreateUserValues } from '@/modules/users/schemas';
import { ApiError } from '@/types/api';

export function UsersPage(): React.ReactElement {
  const usersQuery = useUsers();
  const createUser = useCreateUser();
  const deactivateUser = useDeactivateUser();
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<CreateUserValues>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      email: '',
      firstName: '',
      lastName: '',
      phone: '',
      role: 'salesperson',
      temporaryPassword: '',
      receivesLeads: true,
    },
  });

  async function onCreate(values: CreateUserValues): Promise<void> {
    setFormError(null);
    setInviteToken(null);
    try {
      const res = await createUser.mutateAsync(values);
      setInviteToken(res.data.inviteToken);
      form.reset({
        email: '',
        firstName: '',
        lastName: '',
        phone: '',
        role: 'salesperson',
        temporaryPassword: '',
        receivesLeads: true,
      });
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Unable to create user.');
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Users"
        description="Create salespeople with a temporary password. They must change it on first sign-in."
      />

      <form
        className="grid gap-3 rounded-xl border border-border bg-card p-6 sm:grid-cols-2"
        onSubmit={(e) => void form.handleSubmit(onCreate)(e)}
      >
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" {...form.register('email')} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="role">Role</Label>
          <select
            id="role"
            className="flex h-10 w-full rounded-md border border-border bg-card px-3 text-sm"
            {...form.register('role')}
          >
            <option value="salesperson">Salesperson</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="firstName">First name</Label>
          <Input id="firstName" {...form.register('firstName')} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lastName">Last name</Label>
          <Input id="lastName" {...form.register('lastName')} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="temporaryPassword">Temporary password</Label>
          <Input
            id="temporaryPassword"
            type="password"
            {...form.register('temporaryPassword')}
          />
        </div>
        <div className="flex items-end gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={Boolean(form.watch('receivesLeads'))}
              onChange={(e) => form.setValue('receivesLeads', e.target.checked)}
            />
            Receives leads
          </label>
        </div>
        {formError ? <p className="text-sm text-destructive sm:col-span-2">{formError}</p> : null}
        {inviteToken ? (
          <p className="text-sm text-muted-foreground sm:col-span-2">
            User created. Email invite delivery is disabled. Share this invite token out-of-band if
            needed: <code className="break-all text-foreground">{inviteToken}</code>
          </p>
        ) : null}
        <div className="sm:col-span-2">
          <Button type="submit" disabled={createUser.isPending}>
            Create user
          </Button>
        </div>
      </form>

      {usersQuery.isLoading ? <LoadingState /> : null}
      {usersQuery.isError ? (
        <ErrorState
          message={usersQuery.error instanceof ApiError ? usersQuery.error.message : 'Failed to load users.'}
          onRetry={() => void usersQuery.refetch()}
        />
      ) : null}
      {usersQuery.data && usersQuery.data.data.length === 0 ? (
        <EmptyState title="No users yet" description="Create the first salesperson above." />
      ) : null}
      {usersQuery.data && usersQuery.data.data.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/50">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {usersQuery.data.data.map((user) => (
                <tr key={user.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    {user.firstName} {user.lastName}
                  </td>
                  <td className="px-4 py-3">{user.email}</td>
                  <td className="px-4 py-3">{user.role}</td>
                  <td className="px-4 py-3">{user.isActive ? 'Active' : 'Inactive'}</td>
                  <td className="px-4 py-3">
                    {user.isActive ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void deactivateUser.mutateAsync(user.id)}
                      >
                        Deactivate
                      </Button>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
