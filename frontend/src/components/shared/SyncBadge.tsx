import { CloudOff, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { useFieldSync } from '@/modules/offline/useFieldSync';

/** Header pill: offline state and unsynced field forms. Also auto-syncs when the connection returns. */
export function SyncBadge(): React.ReactElement | null {
  const { online, unsynced, syncing } = useFieldSync(true);
  if (online && unsynced === 0 && !syncing) return null;
  return (
    <Link
      to="/app/field"
      aria-live="polite"
      className={cn('inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium', online ? 'border-warning bg-warning/15 text-[#8a5a10]' : 'border-danger bg-danger/10 text-danger')}
    >
      {online ? <RefreshCw className={cn('h-3.5 w-3.5', syncing && 'animate-spin')} aria-hidden /> : <CloudOff className="h-3.5 w-3.5" aria-hidden />}
      {!online ? `Offline${unsynced ? ` · ${unsynced} unsynced` : ''}` : syncing ? 'Syncing…' : `${unsynced} unsynced`}
    </Link>
  );
}
