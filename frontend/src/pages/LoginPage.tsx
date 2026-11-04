import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { loginRequest } from '@/modules/auth/api';
import { loginSchema, type LoginValues } from '@/modules/auth/schemas';
import { useAuthStore } from '@/stores/auth-store';
import { ApiError } from '@/types/api';

export function LoginPage(): React.ReactElement {
  const navigate = useNavigate();
  const location = useLocation();
  const setSession = useAuthStore((s) => s.setSession);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  async function onSubmit(values: LoginValues): Promise<void> {
    setError(null);
    try {
      const res = await loginRequest(values.email, values.password);
      setSession(res.data.accessToken, res.data.user);
      if (res.data.user.mustChangePassword) {
        void navigate('/app/change-password', { replace: true });
        return;
      }
      const redirect =
        (location.state as { from?: string } | null)?.from &&
        (location.state as { from?: string }).from !== '/login'
          ? (location.state as { from: string }).from
          : '/app';
      void navigate(redirect, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to sign in.');
    }
  }

  return (
    <form className="space-y-4" onSubmit={(e) => void form.handleSubmit(onSubmit)(e)}>
      <div>
        <h1 className="text-xl font-semibold">Sign in</h1>
        <p className="text-sm text-muted-foreground">Use your work email and password.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" autoComplete="username" {...form.register('email')} />
        {form.formState.errors.email ? (
          <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
        ) : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          {...form.register('password')}
        />
        {form.formState.errors.password ? (
          <p className="text-xs text-destructive">{form.formState.errors.password.message}</p>
        ) : null}
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button className="w-full" type="submit" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting ? 'Signing in…' : 'Sign in'}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        <Link to="/reset-password">Forgot password</Link>
      </p>
    </form>
  );
}
