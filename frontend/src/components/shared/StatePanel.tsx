import type { ReactElement } from 'react';

export function LoadingState({ label = 'Loading…' }: { label?: string }): ReactElement {
  return (
    <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}

export function EmptyState({
  title,
  description,
}: {
  title: string;
  description?: string;
}): ReactElement {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center">
      <p className="font-medium text-foreground">{title}</p>
      {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}): ReactElement {
  return (
    <div className="rounded-lg border border-destructive/30 bg-card p-8 text-center">
      <p className="font-medium text-destructive">{message}</p>
      {onRetry ? (
        <button
          type="button"
          className="mt-3 text-sm text-primary underline"
          onClick={onRetry}
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}
