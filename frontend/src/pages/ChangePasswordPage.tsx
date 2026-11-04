import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { changePasswordRequest, meRequest } from '@/modules/auth/api';
import { changePasswordSchema, type ChangePasswordValues } from '@/modules/auth/schemas';
import { useAuthStore } from '@/stores/auth-store';
import { ApiError } from '@/types/api';

export function ChangePasswordPage(): React.ReactElement {
  const navigate = useNavigate();
  const setUser = useAuthStore((s) => s.setUser);
  const mustChange = useAuthStore((s) => s.user?.mustChangePassword);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const form = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  async function onSubmit(values: ChangePasswordValues): Promise<void> {
    setError(null);
    setSuccess(false);
    try {
      await changePasswordRequest(values.currentPassword, values.newPassword);
      const me = await meRequest();
      setUser(me.data);
      setSuccess(true);
      form.reset();
      if (mustChange) {
        void navigate('/app', { replace: true });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to change password.');
    }
  }

  return (
    <div className="max-w-lg">
      <PageHeader
        title="Change password"
        description={
          mustChange
            ? 'You must set a new password before continuing.'
            : 'Choose a new password (12–128 characters).'
        }
      />
      <form
        className="space-y-4 rounded-xl border border-border bg-card p-6"
        onSubmit={(e) => void form.handleSubmit(onSubmit)(e)}
      >
        <div className="space-y-2">
          <Label htmlFor="currentPassword">Current password</Label>
          <Input
            id="currentPassword"
            type="password"
            autoComplete="current-password"
            {...form.register('currentPassword')}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="newPassword">New password</Label>
          <Input
            id="newPassword"
            type="password"
            autoComplete="new-password"
            {...form.register('newPassword')}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirm new password</Label>
          <Input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            {...form.register('confirmPassword')}
          />
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {success ? <p className="text-sm text-primary">Password updated.</p> : null}
        <Button type="submit" disabled={form.formState.isSubmitting}>
          Update password
        </Button>
      </form>
    </div>
  );
}
