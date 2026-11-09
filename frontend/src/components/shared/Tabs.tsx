import { cn } from '@/lib/cn';

export type TabDef = { key: string; label: string; count?: number };

/** Accessible, horizontally scrollable tab strip (keeps tables usable on phones). */
export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: TabDef[];
  active: string;
  onChange: (key: string) => void;
}): React.ReactElement {
  return (
    <div role="tablist" aria-label="Sections" className="mb-4 flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((t) => {
        const selected = t.key === active;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`tab-${t.key}`}
            aria-selected={selected}
            aria-controls={`panel-${t.key}`}
            onClick={() => onChange(t.key)}
            className={cn(
              '-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              selected ? 'border-brand text-brand' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
            {t.count !== undefined ? <span className="ml-1.5 rounded-full bg-muted px-1.5 text-xs">{t.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ id, children }: { id: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`}>
      {children}
    </div>
  );
}
