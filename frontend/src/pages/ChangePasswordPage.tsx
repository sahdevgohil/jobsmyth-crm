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
  const mustChange = useAuthStore((s) => s.user?.mustChangePassword === true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const form = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });
  const { errors, isSubmitting } = form.formState;

  async function onSubmit(values: ChangePasswordValues): Promise<void> {
    setError(null);
    setSuccess(false);
    try {
      await changePasswordRequest(values.currentPassword, values.newPassword);
      const me = await meRequest();
      setUser(me.data);
      if (me.data.mustChangePassword) {
        setError('Password was updated but the account still requires a password change. Please try again or sign in again.');
        return;
      }
      setSuccess(true);
      form.reset();
      void navigate('/app', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        const detail = err.details?.map((d) => d.message).join(' ');
        setError(detail ? `${err.message} ${detail}` : err.message);
        return;
      }
      setError('Unable to change password. Check your connection and try again.');
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
        noValidate
      >
        <div className="space-y-2">
          <Label htmlFor="currentPassword">Current password</Label>
          <Input
            id="currentPassword"
            type="password"
            autoComplete="current-password"
            aria-invalid={Boolean(errors.currentPassword)}
            {...form.register('currentPassword')}
          />
          {errors.currentPassword ? (
            <p className="text-xs text-destructive">{errors.currentPassword.message}</p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="newPassword">New password</Label>
          <Input
            id="newPassword"
            type="password"
            autoComplete="new-password"
            aria-invalid={Boolean(errors.newPassword)}
            {...form.register('newPassword')}
          />
          {errors.newPassword ? (
            <p className="text-xs text-destructive">{errors.newPassword.message}</p>
          ) : null}
          <p className="text-xs text-muted-foreground">Must be 12–128 characters.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirm new password</Label>
          <Input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            aria-invalid={Boolean(errors.confirmPassword)}
            {...form.register('confirmPassword')}
          />
          {errors.confirmPassword ? (
            <p className="text-xs text-destructive">{errors.confirmPassword.message}</p>
          ) : null}
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {success ? <p className="text-sm text-brand">Password updated. Redirecting…</p> : null}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Updating…' : 'Update password'}
        </Button>
      </form>
    </div>
  );
}
