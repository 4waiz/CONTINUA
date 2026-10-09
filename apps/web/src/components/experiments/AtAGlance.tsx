'use client';
/* Copyright (c) 2026 Kanban Studios F.Z.E. All rights reserved. Proprietary - see LICENSE. KS-CONTINUA-2C8B22B15907 */

/**
 * A comparison at a glance: every trial of every strategy as one small rover,
 * green if the operator never lost the link in that drive, red if they did.
 *
 * Read from the experiment's own per-trial records (`results.raw[policy][i]`,
 * `continuity.session_reconnects`), in trial order, so the twentieth icon is
 * the twentieth paired drive - the same seed for every strategy. Cost is the
 * mean of the run's `cost_units`, the simulator's relative cost model (data
 * carried on each network plus every activation), and is labelled as such.
 * Nothing here is rounded into a better story: an experiment without per-trial
 * records shows nothing rather than a guess.
 */

import { STRATEGY } from '@/components/mission/plain';
import type { PolicyIdString } from '@continua/contracts/engine';

interface TrialRecord {
  continuity?: { session_reconnects?: number; total_interruption_s?: number; safe_stop_runs?: number };
}

export interface GlanceRow {
  policy: PolicyIdString;
  trials: boolean[];
  cost: number | null;
  interruption: number | null;
}

/** The rows an experiment's per-trial records support, in the order asked for. */
export function glanceRows(results: Record<string, unknown> | null, order: readonly PolicyIdString[]): GlanceRow[] {
  const raw = (results?.raw ?? null) as Record<string, TrialRecord[]> | null;
  const aggregate = (results?.aggregate ?? null) as Record<string, Record<string, { mean?: number }>> | null;
  if (!raw) return [];
  return order.flatMap((policy) => {
    const runs = raw[policy];
    if (!runs || runs.length === 0) return [];
    return [
      {
        policy,
        trials: runs.map((run) => (run.continuity?.session_reconnects ?? 0) === 0),
        cost: aggregate?.[policy]?.cost_units?.mean ?? null,
        interruption: aggregate?.[policy]?.total_interruption_s?.mean ?? null,
      },
    ];
  });
}

function RoverGlyph({ kept }: { kept: boolean }) {
  return (
    <svg viewBox="0 0 16 12" className="glance-rover" data-kept={kept} aria-hidden>
      <rect x="1.2" y="3" width="13.6" height="5.6" rx="1.8" />
      <rect x="4" y="0.8" width="7" height="3.2" rx="1" />
      <circle cx="4.4" cy="9.6" r="1.7" />
      <circle cx="11.6" cy="9.6" r="1.7" />
    </svg>
  );
}

export function AtAGlance({
  rows,
  highlight,
  compact = false,
}: {
  rows: GlanceRow[];
  /** The row to draw as the subject. */
  highlight?: PolicyIdString;
  compact?: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="glance" data-compact={compact}>
      {rows.map((row) => {
        const kept = row.trials.filter(Boolean).length;
        const subject = row.policy === highlight;
        return (
          <div key={row.policy} className="glance-row" data-subject={subject}>
            <div className="glance-name">
              <span className="font-semibold text-[color:var(--color-ink)]">{STRATEGY[row.policy]?.name ?? row.policy}</span>
              <span className="metric text-[11px] text-[color:var(--color-faint)]">{row.policy}</span>
            </div>
            <div className="glance-icons" role="img" aria-label={`${kept} of ${row.trials.length} drives kept the link`}>
              {row.trials.map((ok, index) => (
                <RoverGlyph key={index} kept={ok} />
              ))}
            </div>
            <div className="glance-score">
              <span className="metric" style={{ color: kept === row.trials.length ? 'var(--color-good)' : kept === 0 ? 'var(--color-bad)' : 'var(--color-warn)' }}>
                {kept}/{row.trials.length}
              </span>
              <span className="text-[11px] text-[color:var(--color-faint)]">kept the link</span>
            </div>
            <div className="glance-cost" title="Mean cost per drive in the simulator's cost model: data on each network plus each activation. Relative units, not money.">
              <span className="metric">{row.cost !== null ? row.cost.toFixed(2) : 'unavailable'}</span>
              <span className="text-[11px] text-[color:var(--color-faint)]">cost</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
