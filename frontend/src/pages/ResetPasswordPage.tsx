import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { forgotPasswordRequest, resetPasswordRequest } from '@/modules/auth/api';
import { resetPasswordSchema, type ResetPasswordValues } from '@/modules/auth/schemas';
import { ApiError } from '@/types/api';
import { z } from 'zod';

const forgotSchema = z.object({ email: z.string().email() });

export function ResetPasswordPage(): React.ReactElement {
  const [params] = useSearchParams();
  const tokenFromUrl = params.get('token') ?? '';
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const forgotForm = useForm<{ email: string }>({
    resolver: zodResolver(forgotSchema),
    defaultValues: { email: '' },
  });
  const resetForm = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { token: tokenFromUrl, newPassword: '', confirmPassword: '' },
  });

  async function onForgot(values: { email: string }): Promise<void> {
    setError(null);
    try {
      const res = await forgotPasswordRequest(values.email);
      setMessage(
        res.data.emailDeliveryEnabled
          ? res.data.message
          : `${res.data.message} Email delivery is not configured yet (INT-03). Ask an Admin to set a temporary password.`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Request failed.');
    }
  }

  async function onReset(values: ResetPasswordValues): Promise<void> {
    setError(null);
    try {
      await resetPasswordRequest(values.token, values.newPassword);
      setMessage('Password reset. You can sign in.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Reset failed.');
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Reset password</h1>
        <p className="text-sm text-muted-foreground">
          Email delivery is disabled until Resend is validated. Admins can set a temporary password
          instead.
        </p>
      </div>

      <form className="space-y-3" onSubmit={(e) => void forgotForm.handleSubmit(onForgot)(e)}>
        <Label htmlFor="email">Request reset (when email is enabled)</Label>
        <Input id="email" type="email" {...forgotForm.register('email')} />
        <Button type="submit" variant="outline" className="w-full">
          Request reset link
        </Button>
      </form>

      <form className="space-y-3" onSubmit={(e) => void resetForm.handleSubmit(onReset)(e)}>
        <Label htmlFor="token">Reset token</Label>
        <Input id="token" {...resetForm.register('token')} />
        <Label htmlFor="newPassword">New password</Label>
        <Input id="newPassword" type="password" {...resetForm.register('newPassword')} />
        <Label htmlFor="confirmPassword">Confirm password</Label>
        <Input id="confirmPassword" type="password" {...resetForm.register('confirmPassword')} />
        <Button type="submit" className="w-full">
          Set new password
        </Button>
      </form>

      {message ? <p className="text-sm text-primary">{message}</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <p className="text-center text-sm">
        <Link to="/login">Back to sign in</Link>
      </p>
    </div>
  );
}
