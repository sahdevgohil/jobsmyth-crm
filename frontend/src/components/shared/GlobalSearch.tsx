import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/services/http';

type Hit = { entityType: string; id: string; label: string; href: string };

export function GlobalSearch(): React.ReactElement {
  const [q, setQ] = useState('');
  const search = useQuery({
    queryKey: ['search', q],
    queryFn: () => apiFetch<{ data: Hit[] }>(`/search?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length >= 2,
  });

  return (
    <div className="relative w-full max-w-xs">
      <Input
        placeholder="Search CRM…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Global search"
      />
      {q.trim().length >= 2 && search.data ? (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-card text-sm shadow">
          {search.data.data.length === 0 ? (
            <li className="px-3 py-2 text-muted-foreground">No matches</li>
          ) : (
            search.data.data.map((hit) => (
              <li key={`${hit.entityType}-${hit.id}`}>
                <Link
                  to={hit.href}
                  className="block px-3 py-2 hover:bg-accent"
                  onClick={() => setQ('')}
                >
                  <span className="text-xs uppercase text-muted-foreground">{hit.entityType}</span>
                  <br />
                  {hit.label}
                </Link>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
