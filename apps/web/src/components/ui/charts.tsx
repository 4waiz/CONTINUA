'use client';

/**
 * Small, honest charts.
 *
 * Every series accepts `(number | null)[]`. A `null` is a gap in the data and is
 * drawn as a gap — the line breaks. Charts here never interpolate across
 * missing measurements, because a continuous line through a hole implies the
 * value was measured when it was not.
 */

import { useId, useMemo } from 'react';

export interface Series {
  label: string;
  color: string;
  values: (number | null)[];
  /** Optional independent axis for a second series (e.g. dBm against Mbps). */
  axis?: 'left' | 'right';
  unit?: string;
}

function extent(values: (number | null)[]): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (value === null || !Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (min === Infinity) return [0, 1];
  if (min === max) return [min - 1, max + 1];
  return [min, max];
}

function buildPath(
  values: (number | null)[],
  width: number,
  height: number,
  min: number,
  max: number,
  pad: number,
): string {
  const span = max - min || 1;
  const usable = height - pad * 2;
  let path = '';
  let pen = false;
  values.forEach((value, index) => {
    if (value === null || !Number.isFinite(value)) {
      pen = false; // break the line: this is a gap, not a straight segment
      return;
    }
    const x = values.length > 1 ? (index / (values.length - 1)) * width : width / 2;
    const y = pad + usable - ((value - min) / span) * usable;
    path += `${pen ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)} `;
    pen = true;
  });
  return path.trim();
}

export function Sparkline({
  values,
  color,
  height = 34,
  width = 240,
  fill = true,
}: {
  values: (number | null)[];
  color: string;
  height?: number;
  width?: number;
  fill?: boolean;
}) {
  const id = useId();
  const [min, max] = useMemo(() => extent(values), [values]);
  const path = useMemo(() => buildPath(values, width, height, min, max, 3), [values, width, height, min, max]);
  const hasData = values.some((v) => v !== null && Number.isFinite(v));

  if (!hasData) {
    return (
      <div
        className="flex items-center justify-center text-[10px] text-[color:var(--color-muted)]"
        style={{ height }}
      >
        no samples yet
      </div>
    );
  }

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" preserveAspectRatio="none" aria-hidden>
      {fill && (
        <>
          <defs>
            <linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.22" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {path && <path d={`${path} L${width} ${height} L0 ${height} Z`} fill={`url(#g${id})`} />}
        </>
      )}
      <path d={path} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function TimeSeries({
  series,
  height = 120,
  xLabels,
  title,
}: {
  series: Series[];
  height?: number;
  xLabels?: [string, string, string];
  title?: string;
}) {
  const width = 320;
  const pad = 6;
  const left = series.filter((s) => (s.axis ?? 'left') === 'left');
  const right = series.filter((s) => s.axis === 'right');
  const leftExtent = useMemo(() => extent(left.flatMap((s) => s.values)), [left]);
  const rightExtent = useMemo(() => extent(right.flatMap((s) => s.values)), [right]);
  const anyData = series.some((s) => s.values.some((v) => v !== null && Number.isFinite(v)));

  return (
    <figure className="m-0">
      {title && <figcaption className="panel-label mb-1">{title}</figcaption>}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pb-1">
        {series.map((s) => (
          <span key={s.label} className="flex items-center gap-1 text-[10.5px] text-[color:var(--color-muted)]">
            <span className="inline-block h-[2px] w-3 rounded" style={{ background: s.color }} />
            {s.label}
            {s.unit ? ` (${s.unit})` : ''}
          </span>
        ))}
      </div>
      {anyData ? (
        <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" preserveAspectRatio="none" role="img">
          <title>{title ?? series.map((s) => s.label).join(', ')}</title>
          {[0.25, 0.5, 0.75].map((fraction) => (
            <line
              key={fraction}
              x1={0}
              x2={width}
              y1={pad + (height - pad * 2) * fraction}
              y2={pad + (height - pad * 2) * fraction}
              stroke="var(--color-line)"
              strokeWidth={1}
            />
          ))}
          {series.map((s) => {
            const [min, max] = (s.axis ?? 'left') === 'left' ? leftExtent : rightExtent;
            return (
              <path
                key={s.label}
                d={buildPath(s.values, width, height, min, max, pad)}
                fill="none"
                stroke={s.color}
                strokeWidth={1.5}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            );
          })}
        </svg>
      ) : (
        <div
          className="grid place-items-center rounded-[8px] border border-dashed border-[color:var(--color-line)] text-[11px] text-[color:var(--color-muted)]"
          style={{ height }}
        >
          waiting for measurements
        </div>
      )}
      {xLabels && (
        <div className="mt-0.5 flex justify-between text-[10px] text-[color:var(--color-muted)]">
          <span>{xLabels[0]}</span>
          <span>{xLabels[1]}</span>
          <span>{xLabels[2]}</span>
        </div>
      )}
    </figure>
  );
}

export function Bars({
  values,
  color,
  height = 40,
  max,
}: {
  values: (number | null)[];
  color: string;
  height?: number;
  max?: number;
}) {
  const ceiling = max ?? Math.max(1, ...values.map((v) => (v === null ? 0 : v)));
  const width = 240;
  const barWidth = values.length ? width / values.length : width;
  const hasData = values.some((v) => v !== null && Number.isFinite(v));
  if (!hasData) {
    return (
      <div
        className="flex items-center justify-center text-[10px] text-[color:var(--color-muted)]"
        style={{ height }}
      >
        no samples yet
      </div>
    );
  }
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" preserveAspectRatio="none" aria-hidden>
      {values.map((value, index) => {
        if (value === null || !Number.isFinite(value)) return null;
        const barHeight = Math.max(1, (value / ceiling) * (height - 2));
        return (
          <rect
            key={index}
            x={index * barWidth + barWidth * 0.15}
            y={height - barHeight}
            width={barWidth * 0.7}
            height={barHeight}
            rx={Math.min(1.5, barWidth * 0.25)}
            fill={color}
            opacity={0.35 + 0.65 * (value / ceiling)}
          />
        );
      })}
    </svg>
  );
}

/** A single horizontal meter with an explicit denominator. */
export function Meter({
  value,
  max = 100,
  color,
  label,
}: {
  value: number | null;
  max?: number;
  color: string;
  label?: string;
}) {
  const available = value !== null && Number.isFinite(value);
  const pct = available ? Math.min(100, Math.max(0, (value! / max) * 100)) : 0;
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--color-line)]"
      role="meter"
      aria-valuenow={available ? value! : undefined}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label}
      title={available ? `${value} / ${max}` : 'unavailable'}
    >
      <div
        className="h-full rounded-full transition-[width] duration-300"
        style={{ width: `${pct}%`, background: available ? color : 'transparent' }}
      />
    </div>
  );
}
