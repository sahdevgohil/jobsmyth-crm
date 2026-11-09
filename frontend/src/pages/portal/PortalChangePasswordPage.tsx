import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { portalChangePasswordRequest, portalMeRequest } from '@/modules/portal/api';
import { usePortalAuthStore } from '@/stores/portal-auth-store';
import { ApiError } from '@/types/api';

export function PortalChangePasswordPage(): React.ReactElement {
  const navigate = useNavigate();
  const setAccount = usePortalAuthStore((s) => s.setAccount);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 12) {
      setError('New password must be at least 12 characters.');
      return;
    }
    setSubmitting(true);
    try {
      await portalChangePasswordRequest(currentPassword, newPassword);
      const me = await portalMeRequest();
      setAccount(me.data);
      void navigate('/portal', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to change password.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="mx-auto max-w-md space-y-4" onSubmit={(e) => void onSubmit(e)}>
      <div>
        <h1 className="text-xl font-semibold">Change password</h1>
        <p className="text-sm text-muted-foreground">
          Choose a new password before continuing in the portal.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="current">Current password</Label>
        <Input
          id="current"
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="next">New password</Label>
        <Input
          id="next"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit" disabled={submitting}>
        {submitting ? 'Saving…' : 'Update password'}
      </Button>
    </form>
  );
}
