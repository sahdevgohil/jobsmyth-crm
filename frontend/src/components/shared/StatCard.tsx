import type { LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/cn';

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  to,
  tone = 'default',
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon?: LucideIcon;
  to?: string;
  tone?: 'default' | 'danger' | 'warning';
}): React.ReactElement {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        {Icon ? (
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary text-brand">
            <Icon className="h-4 w-4" aria-hidden />
          </span>
        ) : null}
      </div>
      <p
        className={cn(
          'mt-2 text-2xl font-semibold tabular-nums',
          tone === 'danger' && 'text-danger',
          tone === 'warning' && 'text-[#8a5a10]',
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </>
  );
  const cls = 'block rounded-lg border border-border bg-card p-4 shadow-sm';
  return to ? (
    <Link to={to} className={cn(cls, 'transition-colors hover:border-brand')}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
