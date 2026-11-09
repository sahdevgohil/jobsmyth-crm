import type { ReactElement, ReactNode } from 'react';
import { Button } from '@/components/ui/button';

export function LoadingState({ label = 'Loading…' }: { label?: string }): ReactElement {
  return (
    <div role="status" className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
      <span
        className="mr-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-brand border-t-transparent align-middle"
        aria-hidden
      />
      {label}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}): ReactElement {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center">
      <p className="font-medium text-foreground">{title}</p>
      {description ? <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-4 flex justify-center gap-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }): ReactElement {
  return (
    <div role="alert" className="rounded-lg border border-danger/30 bg-card p-8 text-center">
      <p className="font-medium text-danger">{message}</p>
      {onRetry ? (
        <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
