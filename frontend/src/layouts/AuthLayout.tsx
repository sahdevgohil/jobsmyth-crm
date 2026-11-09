import { Outlet } from 'react-router-dom';
import { BrandLogo } from '@/components/shared/BrandLogo';

export function AuthLayout(): React.ReactElement {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md overflow-hidden rounded-xl border border-border border-t-4 border-t-brand bg-card shadow-sm">
        <div className="flex flex-col items-center border-b border-border px-6 pb-4 pt-6 text-center">
          <BrandLogo height={140} />
          <p className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">Internal operations platform</p>
        </div>
        <div className="p-6">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
