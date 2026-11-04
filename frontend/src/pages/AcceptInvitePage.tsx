import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { acceptInviteRequest } from '@/modules/auth/api';
import { resetPasswordSchema, type ResetPasswordValues } from '@/modules/auth/schemas';
import { ApiError } from '@/types/api';

export function AcceptInvitePage(): React.ReactElement {
  const [params] = useSearchParams();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: {
      token: params.get('token') ?? '',
      newPassword: '',
      confirmPassword: '',
    },
  });

  async function onSubmit(values: ResetPasswordValues): Promise<void> {
    setError(null);
    try {
      await acceptInviteRequest(values.token, values.newPassword);
      setMessage('Invite accepted. You can sign in.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to accept invite.');
    }
  }

  return (
    <form className="space-y-4" onSubmit={(e) => void form.handleSubmit(onSubmit)(e)}>
      <div>
        <h1 className="text-xl font-semibold">Accept invite</h1>
        <p className="text-sm text-muted-foreground">
          Set your password using the invite token from your Admin. Email invites are disabled until
          INT-03 is configured.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="token">Invite token</Label>
        <Input id="token" {...form.register('token')} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="newPassword">Password</Label>
        <Input id="newPassword" type="password" {...form.register('newPassword')} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirmPassword">Confirm password</Label>
        <Input id="confirmPassword" type="password" {...form.register('confirmPassword')} />
      </div>
      {message ? <p className="text-sm text-primary">{message}</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit" className="w-full">
        Set password
      </Button>
      <p className="text-center text-sm">
        <Link to="/login">Back to sign in</Link>
      </p>
    </form>
  );
}
