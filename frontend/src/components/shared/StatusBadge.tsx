import { cn } from '@/lib/cn';
import { statusLabel } from '@/lib/status';

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const TONES: Record<Tone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/15 text-[#8a5a10]',
  danger: 'bg-danger/10 text-danger',
  info: 'bg-info/10 text-info',
};

const STATUS_TONE: Record<string, Tone> = {
  active: 'success', completed: 'success', paid: 'success', accepted: 'success', won: 'success',
  delivered: 'success', done: 'success', confirmed: 'success', signed: 'success', recorded: 'success',
  sent: 'info', scheduled: 'info', in_progress: 'info', planning: 'info', viewed: 'info', ordered: 'info',
  approved: 'info', partially_paid: 'info', open: 'info', materials_preparation: 'info',
  draft: 'neutral', needed: 'neutral', not_requested: 'neutral', inactive: 'neutral', closed: 'neutral',
  not_configured: 'neutral', received: 'neutral', awaiting_approval: 'neutral', manual_only: 'neutral', normal: 'neutral',
  on_hold: 'warning', quality_review: 'warning', blocked: 'warning', pending: 'warning', high: 'warning', expired: 'warning',
  overdue: 'danger', cancelled: 'danger', rejected: 'danger', lost: 'danger', failed: 'danger', urgent: 'danger',
  void: 'danger', no_show: 'danger', error: 'danger',
};

export function StatusBadge({ status, tone, className }: { status: string; tone?: Tone; className?: string }): React.ReactElement {
  const t = tone ?? STATUS_TONE[status] ?? 'neutral';
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', TONES[t], className)}>
      {statusLabel(status)}
    </span>
  );
}
