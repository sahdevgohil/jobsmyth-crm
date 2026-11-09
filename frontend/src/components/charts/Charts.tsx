import { useState } from 'react';
import { formatCents } from '@/lib/money';
import { SERIES } from './series';


export function Legend({ items }: { items: Array<{ label: string; color: string }> }): React.ReactElement {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/** Horizontal bars for a single measure (one hue). */
export function BarList({
  rows,
  color = SERIES.primary,
  onSelect,
}: {
  rows: Array<{ key: string; label: string; value: number; hint?: string }>;
  color?: string;
  onSelect?: (key: string) => void;
}): React.ReactElement {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => {
        const inner = (
          <>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate">{r.label}</span>
              <span className="tabular-nums text-muted-foreground">
                <span className="font-medium text-foreground">{r.value}</span>
                {r.hint ? <span className="ml-2 text-xs">{r.hint}</span> : null}
              </span>
            </div>
            <div className="h-2 rounded-full bg-muted" aria-hidden>
              <div className="h-2 rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: color, minWidth: r.value > 0 ? 6 : 0 }} />
            </div>
          </>
        );
        return (
          <li key={r.key}>
            {onSelect ? (
              <button type="button" className="block w-full text-left" onClick={() => onSelect(r.key)}>
                {inner}
              </button>
            ) : (
              inner
            )}
          </li>
        );
      })}
    </ul>
  );
}

type TrendPoint = { period: string; a: number; b: number };

function fmtPeriod(p: string, g: 'day' | 'week' | 'month'): string {
  const d = new Date(`${p.length === 7 ? `${p}-01` : p}T00:00:00Z`);
  return g === 'month'
    ? d.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' })
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** Two-series grouped columns with hover tooltip; integer-cent values formatted as currency. */
export function RevenueChart({
  points,
  granularity,
  labelA,
  labelB,
}: {
  points: TrendPoint[];
  granularity: 'day' | 'week' | 'month';
  labelA: string;
  labelB: string;
}): React.ReactElement {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = 220;
  const pad = { l: 56, r: 8, t: 8, b: 26 };
  const max = Math.max(1, ...points.flatMap((p) => [p.a, p.b]));
  const step = (W - pad.l - pad.r) / Math.max(1, points.length);
  const barW = Math.max(3, Math.min(18, step / 2.6));
  const y = (v: number): number => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const ticks = [0, 0.5, 1].map((f) => Math.round(max * f));
  const labelEvery = Math.ceil(points.length / 8);
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${labelA} and ${labelB} by ${granularity}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#e1e1e1" strokeWidth={1} />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize={10} fill="#757575">
              {formatCents(t).replace(/\.00$/, '')}
            </text>
          </g>
        ))}
        {points.map((p, i) => {
          const cx = pad.l + step * i + step / 2;
          return (
            <g key={p.period} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={cx - step / 2} y={pad.t} width={step} height={H - pad.t - pad.b} fill={hover === i ? '#f5f5f5' : 'transparent'} />
              <rect x={cx - barW - 1} y={y(p.a)} width={barW} height={H - pad.b - y(p.a)} rx={2} fill={SERIES.primary} />
              <rect x={cx + 1} y={y(p.b)} width={barW} height={H - pad.b - y(p.b)} rx={2} fill={SERIES.secondary} />
              {i % labelEvery === 0 ? (
                <text x={cx} y={H - 8} textAnchor="middle" fontSize={10} fill="#757575">
                  {fmtPeriod(p.period, granularity)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {hover !== null && points[hover] ? (
        <div className="pointer-events-none absolute right-2 top-0 rounded-md border border-border bg-card px-3 py-2 text-xs shadow-md">
          <p className="font-medium">{fmtPeriod(points[hover].period, granularity)}</p>
          <p className="text-foreground">
            <span className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: SERIES.primary }} />
            {labelA}: {formatCents(points[hover].a)}
          </p>
          <p>
            <span className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: SERIES.secondary }} />
            {labelB}: {formatCents(points[hover].b)}
          </p>
        </div>
      ) : null}
    </div>
  );
}
