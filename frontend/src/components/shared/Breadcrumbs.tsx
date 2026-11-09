import { ChevronRight } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

const LABELS: Record<string, string> = {
  app: 'Dashboard',
  'after-sales': 'After-sales',
  'work-orders': 'Work orders',
  'pipeline-stages': 'Pipeline stages',
  'change-password': 'Change password',
  audit: 'Audit logs',
};

function label(seg: string): string {
  if (LABELS[seg]) return LABELS[seg];
  if (/^[0-9a-f]{24}$/i.test(seg)) return 'Details';
  const s = seg.replace(/-/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function Breadcrumbs(): React.ReactElement {
  const { pathname } = useLocation();
  const segs = pathname.split('/').filter(Boolean);
  if (segs.length <= 1) return <span className="text-sm font-medium">Dashboard</span>;
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
      {segs.map((seg, i) => {
        const to = '/' + segs.slice(0, i + 1).join('/');
        const last = i === segs.length - 1;
        return (
          <span key={to} className="flex items-center gap-1 truncate">
            {i > 0 ? <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
            {last ? (
              <span className="truncate font-medium text-foreground">{label(seg)}</span>
            ) : (
              <Link to={to} className="truncate text-muted-foreground hover:text-foreground">
                {label(seg)}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
