import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { emptyLine, lineFromStandard, type LineDraft } from './lineDrafts';
import type { LineItemKind, StandardLineItem } from './types';

const fieldClass =
  'w-full rounded-md border border-input bg-background px-2 py-1 text-sm disabled:opacity-60';

export function LineItemEditor({
  lines,
  onChange,
  disabled,
  catalog,
}: {
  lines: LineDraft[];
  onChange: (lines: LineDraft[]) => void;
  disabled?: boolean;
  catalog?: StandardLineItem[];
}): React.ReactElement {
  function patch(key: string, values: Partial<LineDraft>): void {
    onChange(lines.map((l) => (l.key === key ? { ...l, ...values } : l)));
  }

  return (
    <div className="space-y-3">
      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">No line items yet.</p>
      ) : null}
      {lines.map((line, index) => (
        <div
          key={line.key}
          className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-6"
        >
          <div className="sm:col-span-4">
            <label className="text-xs text-muted-foreground" htmlFor={`${line.key}-desc`}>
              Description
            </label>
            <Input
              id={`${line.key}-desc`}
              value={line.description}
              disabled={disabled}
              onChange={(e) => patch(line.key, { description: e.target.value })}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs text-muted-foreground" htmlFor={`${line.key}-kind`}>
              Type
            </label>
            <select
              id={`${line.key}-kind`}
              className={fieldClass}
              value={line.kind}
              disabled={disabled}
              onChange={(e) => patch(line.key, { kind: e.target.value as LineItemKind })}
            >
              <option value="material">Material</option>
              <option value="labor">Labor</option>
              <option value="other">Other</option>
            </select>
          </div>
          {(
            [
              ['quantity', 'Quantity'],
              ['unit', 'Unit'],
              ['unitDollars', 'Unit cost ($)'],
              ['laborDollars', 'Extra labor ($)'],
              ['materialDollars', 'Extra materials ($)'],
            ] as const
          ).map(([field, label]) => (
            <div key={field}>
              <label className="text-xs text-muted-foreground" htmlFor={`${line.key}-${field}`}>
                {label}
              </label>
              <Input
                id={`${line.key}-${field}`}
                value={line[field]}
                disabled={disabled}
                inputMode={field === 'unit' ? 'text' : 'decimal'}
                onChange={(e) => patch(line.key, { [field]: e.target.value })}
              />
            </div>
          ))}
          <div className="flex items-end">
            {disabled ? null : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onChange(lines.filter((l) => l.key !== line.key))}
                aria-label={`Remove line ${index + 1}`}
              >
                Remove
              </Button>
            )}
          </div>
        </div>
      ))}
      {disabled ? null : (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => onChange([...lines, emptyLine()])}>
            Add line
          </Button>
          {catalog && catalog.length > 0 ? (
            <select
              className="rounded-md border border-input bg-background px-2 py-1 text-sm"
              value=""
              aria-label="Add standard item"
              onChange={(e) => {
                const item = catalog.find((c) => c.key === e.target.value);
                if (item) onChange([...lines, lineFromStandard(item)]);
              }}
            >
              <option value="">Add standard item…</option>
              {catalog.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      )}
    </div>
  );
}
