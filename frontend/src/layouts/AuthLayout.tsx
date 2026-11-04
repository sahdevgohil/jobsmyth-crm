import { Outlet } from 'react-router-dom';

export function AuthLayout(): React.ReactElement {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <p className="text-3xl font-semibold tracking-tight text-primary">Legacy Roofing CRM</p>
          <p className="mt-2 text-sm text-muted-foreground">Legacy Construction Group</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
