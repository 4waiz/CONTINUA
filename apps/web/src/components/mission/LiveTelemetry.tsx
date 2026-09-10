'use client';

/**
 * One chart, four things it can show.
 *
 * The panel this replaces stacked two charts and gave the second one the
 * heading "Application health" — directly under a panel already called
 * Application Health, which read as a duplicate. One chart with an explicit
 * toggle is both smaller and less confusing, and it lets the operator choose
 * the series rather than guessing which two we picked for them.
 *
 * Gaps are gaps: a reconnect that dropped events leaves a break in the line,
 * because `TimeSeries` skips nulls rather than joining across them.
 */

import { TimeSeries } from '@/components/ui/charts';
import type { EngineEvent, EngineLinkId } from '@continua/contracts/engine';
import { NETWORK_COLOR } from '@continua/scene';
import { useState } from 'react';

type SeriesId = 'rtt' | 'throughput' | 'loss' | 'jitter';

const SERIES: { id: SeriesId; label: string; unit: string; color: string }[] = [
  { id: 'rtt', label: 'RTT', unit: 'ms', color: '#7a3cff' },
  { id: 'throughput', label: 'Throughput', unit: 'Mbps', color: '#176bff' },
  { id: 'loss', label: 'Loss', unit: '%', color: '#e5484d' },
  { id: 'jitter', label: 'Jitter', unit: 'ms', color: '#14b8e8' },
];

export function LiveTelemetry({ history, link }: { history: EngineEvent[]; link: EngineLinkId }) {
  const [active, setActive] = useState<SeriesId>('rtt');

  const window = history.slice(-180);
  const pick = (id: SeriesId) =>
    window.map((event) => {
      const observation = event.links[link];
      if (!observation) return null;
      if (id === 'rtt') return observation.rtt_ms;
      if (id === 'throughput') return observation.throughput_mbps;
      if (id === 'loss') return observation.loss_pct;
      return observation.jitter_ms;
    });

  const spec = SERIES.find((entry) => entry.id === active)!;
  const values = pick(active);
  const first = window[0]?.t ?? 0;
  const last = window[window.length - 1]?.t ?? 0;

  return (
    <section className="panel px-4 py-3.5">
      <header className="mb-2.5 flex items-center justify-between gap-2">
        <h2 className="panel-label">Live telemetry</h2>
        <span className="text-[11px] text-[color:var(--color-faint)]">{link}</span>
      </header>

      <div className="mb-2.5 flex gap-1">
        {SERIES.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setActive(entry.id)}
            aria-pressed={active === entry.id}
            className="flex-1 rounded-[8px] border px-1 py-1 text-[11px] font-semibold transition"
            style={{
              borderColor: active === entry.id ? `color-mix(in srgb, ${entry.color} 40%, transparent)` : 'var(--color-line)',
              background: active === entry.id ? `color-mix(in srgb, ${entry.color} 9%, white)` : 'var(--color-surface)',
              color: active === entry.id ? entry.color : 'var(--color-muted)',
            }}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <TimeSeries
        series={[
          {
            label: spec.label,
            color: active === 'throughput' ? NETWORK_COLOR[link] : spec.color,
            values,
            unit: spec.unit,
          },
        ]}
        height={104}
        xLabels={[`${first.toFixed(0)}s`, `${((first + last) / 2).toFixed(0)}s`, `${last.toFixed(0)}s`]}
      />
    </section>
  );
}
