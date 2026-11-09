import { Link } from 'react-router-dom';
import { cn } from '@/lib/cn';

export type Column<T> = {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  className?: string;
  /** Hidden below the `md` breakpoint so tables stay usable on phones. */
  hideOnMobile?: boolean;
  align?: 'right';
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  rowHref,
  empty,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  rowHref?: (row: T) => string;
  empty?: React.ReactNode;
}): React.ReactElement {
  if (rows.length === 0 && empty) return <>{empty}</>;
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
      <table className="w-full min-w-full text-left text-sm">
        <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn(
                  'px-4 py-2.5 font-medium',
                  c.hideOnMobile && 'hidden md:table-cell',
                  c.align === 'right' && 'text-right',
                  c.className,
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={rowKey(row)} className="hover:bg-muted/40">
              {columns.map((c, i) => (
                <td
                  key={c.key}
                  className={cn(
                    'px-4 py-3 align-middle',
                    c.hideOnMobile && 'hidden md:table-cell',
                    c.align === 'right' && 'text-right tabular-nums',
                    c.className,
                  )}
                >
                  {i === 0 && rowHref ? (
                    <Link to={rowHref(row)} className="font-medium text-foreground hover:text-brand hover:underline">
                      {c.render(row)}
                    </Link>
                  ) : (
                    c.render(row)
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
