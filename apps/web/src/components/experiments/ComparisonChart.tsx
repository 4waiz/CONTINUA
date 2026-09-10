'use client';

/**
 * One metric, every policy, as bars.
 *
 * A twelve-row table is the right artefact for the repository and the wrong one
 * for a first look: you cannot see from it that B2 spends twelve times the
 * satellite data. Bars make the comparison instant, and the table underneath
 * still carries the exact figures and confidence intervals.
 *
 * The 95 % CI is drawn as a whisker rather than being dropped, because a
 * difference the intervals overlap on is not a difference - and this project
 * does not get to show a bar chart that hides that.
 */

interface Stat {
  n: number;
  mean: number | null;
  ci95_low?: number;
  ci95_high?: number;
}

const POLICY_COLOR: Record<string, string> = {
  B0: '#8995ab',
  B1: '#14b8e8',
  B2: '#5156e8',
  P1: '#176bff',
  'P1-noPred': '#a0a8bd',
  'P1-noApp': '#c0b2d8',
};

export function ComparisonChart({
  title,
  unit,
  scale = 1,
  lowerIsBetter,
  policies,
  values,
}: {
  title: string;
  unit: string;
  /** Divide raw values by this (e.g. 1e6 for bytes → MB). */
  scale?: number;
  lowerIsBetter: boolean;
  policies: string[];
  values: Record<string, Stat | undefined>;
}) {
  const points = policies
    .map((policy) => ({ policy, stat: values[policy] }))
    .filter((entry) => entry.stat && entry.stat.mean !== null && entry.stat.n > 0) as {
    policy: string;
    stat: Stat & { mean: number };
  }[];

  if (points.length === 0) return null;

  const scaled = points.map((entry) => ({
    ...entry,
    value: entry.stat.mean / scale,
    low: entry.stat.ci95_low !== undefined ? entry.stat.ci95_low / scale : null,
    high: entry.stat.ci95_high !== undefined ? entry.stat.ci95_high / scale : null,
  }));

  const max = Math.max(...scaled.map((entry) => Math.max(entry.value, entry.high ?? entry.value)), 0.0001);
  const best = lowerIsBetter
    ? Math.min(...scaled.map((entry) => entry.value))
    : Math.max(...scaled.map((entry) => entry.value));

  const digits = max >= 100 ? 0 : max >= 10 ? 1 : 2;

  return (
    <section className="card px-3.5 py-3">
      <header className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-[12px] font-semibold">{title}</h3>
        <span className="text-[11px] text-[color:var(--color-faint)]">
          {unit || 'count'} · {lowerIsBetter ? 'lower is better' : 'higher is better'}
        </span>
      </header>

      <ul className="flex flex-col gap-[7px]">
        {scaled.map((entry) => {
          const isBest = Math.abs(entry.value - best) < 1e-9;
          const color = POLICY_COLOR[entry.policy] ?? 'var(--color-muted)';
          return (
            <li key={entry.policy} className="grid grid-cols-[62px_minmax(0,1fr)_66px] items-center gap-2">
              <span
                className="metric truncate text-[11px] font-semibold"
                style={{ color: isBest ? color : 'var(--color-muted)' }}
                title={entry.policy}
              >
                {entry.policy}
              </span>

              <div className="relative h-[15px] rounded-[5px] bg-[color:var(--color-surface-muted)]">
                <div
                  className="absolute inset-y-0 left-0 rounded-[5px]"
                  style={{
                    width: `${Math.max(1.5, (entry.value / max) * 100)}%`,
                    background: color,
                    opacity: isBest ? 1 : 0.55,
                  }}
                />
                {entry.low !== null && entry.high !== null && entry.high > entry.low && (
                  <span
                    aria-hidden
                    className="absolute top-1/2 h-[7px] -translate-y-1/2 border-x-[1.5px]"
                    style={{
                      left: `${(entry.low / max) * 100}%`,
                      width: `${((entry.high - entry.low) / max) * 100}%`,
                      borderColor: 'rgb(17 29 58 / 0.42)',
                    }}
                    title={`95 % CI ${entry.low.toFixed(digits)} … ${entry.high.toFixed(digits)} (n=${entry.stat.n})`}
                  />
                )}
              </div>

              <span
                className="metric text-right text-[11.5px] font-semibold"
                style={{ color: isBest ? color : 'var(--color-ink)' }}
              >
                {entry.value.toFixed(digits)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
