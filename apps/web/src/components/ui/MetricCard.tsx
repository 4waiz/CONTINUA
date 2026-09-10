'use client';

/**
 * A single headline measurement: big number, trend, and the context needed to
 * read it honestly.
 *
 * The rule this component exists to enforce: **a value that does not exist is
 * not a zero.** Pass `value={null}` and the card renders an em dash and the
 * reason it is unavailable, rather than a confident `0.0 ms` that an operator
 * would act on. That is why `value` is `number | null` and there is no default.
 */

import type { ReactNode } from 'react';
import { Sparkline } from './charts';

export type MetricTone = 'neutral' | 'good' | 'warn' | 'bad';

const TONE_COLOR: Record<MetricTone, string> = {
  neutral: 'var(--color-ink)',
  good: 'var(--color-good)',
  warn: 'var(--color-warn)',
  bad: 'var(--color-bad)',
};

export function MetricCard({
  label,
  icon,
  value,
  unit,
  format = (n) => n.toFixed(1),
  tone = 'neutral',
  status,
  statusTone = 'neutral',
  context,
  history,
  unavailableReason = 'Waiting for engine',
}: {
  label: string;
  icon?: ReactNode;
  /** `null` means genuinely unmeasured. It is never rendered as 0. */
  value: number | null;
  unit?: string;
  format?: (value: number) => string;
  tone?: MetricTone;
  /** Short state word - "Degrading", "Active". Optional. */
  status?: string;
  statusTone?: MetricTone;
  /** One line under the number saying what window or source it came from. */
  context?: ReactNode;
  /** Recent values for the sparkline. Fewer than two points draws nothing. */
  history?: number[];
  unavailableReason?: string;
}) {
  const has = value !== null && Number.isFinite(value);

  return (
    <article className="card flex flex-col gap-2 px-4 py-3">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[color:var(--color-faint)]">
          {icon}
          <h3 className="text-[11.5px] font-semibold uppercase tracking-[0.085em]">{label}</h3>
        </div>
        {status && (
          <span
            className="rounded-full px-2 py-[2px] text-[11px] font-semibold uppercase tracking-[0.06em]"
            style={{
              color: TONE_COLOR[statusTone],
              background: `color-mix(in srgb, ${TONE_COLOR[statusTone]} 11%, white)`,
            }}
          >
            {status}
          </span>
        )}
      </header>

      <div className="flex items-end justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-1.5">
          {has ? (
            <>
              <span
                className="metric text-[30px] font-semibold leading-none tracking-[-0.035em]"
                style={{ color: TONE_COLOR[tone] }}
              >
                {format(value)}
              </span>
              {unit && (
                <span className="text-[14px] font-medium text-[color:var(--color-muted)]">{unit}</span>
              )}
            </>
          ) : (
            // A dash and a rule, not a sentence. Four cards in a column each
            // explaining that they are waiting is noise, and the run bar
            // already says the engine is offline.
            <span
              className="mb-1.5 block h-[3px] w-9 rounded-full bg-[color:var(--color-line-strong)]"
              title={unavailableReason}
              aria-label={unavailableReason}
            />
          )}
        </div>
        {history && history.length > 1 && (
          // Sparkline scales to its container, so the container is what sizes it.
          <div className="w-[86px] shrink-0">
            <Sparkline
              values={history}
              width={86}
              height={28}
              color={tone === 'neutral' ? 'var(--color-blue)' : TONE_COLOR[tone]}
            />
          </div>
        )}
      </div>

      {has && context && (
        <p className="text-[11.5px] leading-snug text-[color:var(--color-muted)]">{context}</p>
      )}
    </article>
  );
}
