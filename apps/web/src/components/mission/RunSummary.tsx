'use client';

/**
 * The end of a run, stated once: what the session went through, from the
 * metrics file the engine wrote when the run finished. Nothing here is computed
 * in the browser, and a field the file does not have says so.
 *
 * Run beside the reactive baseline, it is a paired comparison - same scenario,
 * route and seed - and the costs of acting early (handovers, overhead, bytes
 * on the expensive link) sit in the same table as the wins.
 */

import Link from 'next/link';
import { CloseIcon, ReplayIcon } from '../ui/icons';

function read(source: Record<string, unknown>, path: string): number | null {
  let node: unknown = source;
  for (const key of path.split('.')) {
    if (node === null || typeof node !== 'object') return null;
    node = (node as Record<string, unknown>)[key];
  }
  return typeof node === 'number' && Number.isFinite(node) ? node : null;
}

function readFlag(source: Record<string, unknown>, path: string): boolean | null {
  let node: unknown = source;
  for (const key of path.split('.')) {
    if (node === null || typeof node !== 'object') return null;
    node = (node as Record<string, unknown>)[key];
  }
  return typeof node === 'boolean' ? node : null;
}

function megabytes(bytes: number | null): string | null {
  return bytes === null ? null : `${(bytes / 1e6).toFixed(1)} MB`;
}

function Figure({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string | null;
  detail?: string | null;
  tone?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium text-[color:var(--color-muted)]">{label}</div>
      {value === null ? (
        <div className="mt-1 text-[13px] font-medium text-[color:var(--color-faint)]">unavailable</div>
      ) : (
        <div className="metric mt-0.5 text-[24px] font-semibold leading-none tracking-[-0.02em]" style={tone ? { color: tone } : undefined}>
          {value}
        </div>
      )}
      {detail && <div className="mt-1 text-[11px] text-[color:var(--color-faint)]">{detail}</div>}
    </div>
  );
}

interface Row {
  label: string;
  base: string | null;
  run: string | null;
  /** Which side the row favours, when lower or higher is plainly better. */
  better?: 'base' | 'run' | null;
  /** A cost of acting early: shown in the same table, never coloured as a win. */
  cost?: boolean;
}

function compareRows(base: Record<string, unknown>, run: Record<string, unknown>): Row[] {
  const lower = (a: number | null, b: number | null): Row['better'] =>
    a === null || b === null || Math.abs(a - b) < 1e-9 ? null : a < b ? 'base' : 'run';
  const seconds = (value: number | null) => (value === null ? null : `${value.toFixed(2)} s`);
  const count = (value: number | null) => (value === null ? null : String(value));
  const flag = (value: boolean | null) => (value === null ? null : value ? 'entered' : 'never');
  const reconnects = [read(base, 'continuity.session_reconnects'), read(run, 'continuity.session_reconnects')] as const;
  const interruption = [read(base, 'continuity.total_interruption_s'), read(run, 'continuity.total_interruption_s')] as const;
  const longest = [read(base, 'continuity.longest_interruption_s'), read(run, 'continuity.longest_interruption_s')] as const;
  const safeStop = [readFlag(base, 'continuity.safe_stop_entered'), readFlag(run, 'continuity.safe_stop_entered')] as const;
  const health = [read(base, 'app_health_score'), read(run, 'app_health_score')] as const;
  const handovers = [read(base, 'control_plane.handovers'), read(run, 'control_plane.handovers')] as const;
  const overhead = [read(base, 'links.overhead_pct'), read(run, 'links.overhead_pct')] as const;
  const satellite = [read(base, 'links.satellite_bytes'), read(run, 'links.satellite_bytes')] as const;
  return [
    { label: 'Session reconnects', base: count(reconnects[0]), run: count(reconnects[1]), better: lower(reconnects[0], reconnects[1]) },
    { label: 'Total interruption', base: seconds(interruption[0]), run: seconds(interruption[1]), better: lower(interruption[0], interruption[1]) },
    { label: 'Longest interruption', base: seconds(longest[0]), run: seconds(longest[1]), better: lower(longest[0], longest[1]) },
    {
      label: 'Safe stop',
      base: flag(safeStop[0]),
      run: flag(safeStop[1]),
      better: safeStop[0] === null || safeStop[1] === null || safeStop[0] === safeStop[1] ? null : safeStop[0] ? 'run' : 'base',
    },
    {
      label: 'Application health',
      base: health[0] === null ? null : health[0].toFixed(0),
      run: health[1] === null ? null : health[1].toFixed(0),
      better: health[0] === null || health[1] === null || Math.abs(health[0] - health[1]) < 0.5 ? null : health[0] > health[1] ? 'base' : 'run',
    },
    { label: 'Handovers', base: count(handovers[0]), run: count(handovers[1]), cost: true },
    {
      label: 'Overhead',
      base: overhead[0] === null ? null : `${overhead[0].toFixed(1)} %`,
      run: overhead[1] === null ? null : `${overhead[1].toFixed(1)} %`,
      cost: true,
    },
    { label: 'Satellite bytes', base: megabytes(satellite[0]), run: megabytes(satellite[1]), cost: true },
  ];
}

function Comparison({ rows, basePolicy, runPolicy }: { rows: Row[]; basePolicy: string; runPolicy: string }) {
  const cell = (value: string | null, good: boolean) =>
    value === null ? (
      <span className="text-[12px] font-medium text-[color:var(--color-faint)]">unavailable</span>
    ) : (
      <span className="metric text-[15px] font-semibold" style={good ? { color: 'var(--color-good)' } : undefined}>
        {value}
      </span>
    );
  return (
    <table className="mt-4 w-full border-t border-[color:var(--color-line)] text-left">
      <thead>
        <tr className="text-[11px] font-semibold">
          <th className="pt-3 pb-1.5 font-medium text-[color:var(--color-muted)]">Same route, scenario and seed</th>
          <th className="pt-3 pb-1.5 text-[color:var(--color-muted)]">Reactive · {basePolicy}</th>
          <th className="pt-3 pb-1.5 text-[color:var(--color-blue)]">CONTINUA · {runPolicy}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label} className="border-t border-[color:var(--color-line)]">
            <td className="py-1.5 text-[12px] text-[color:var(--color-muted)]">
              {row.label}
              {row.cost && <span className="ml-1.5 text-[11px] text-[color:var(--color-faint)]">cost</span>}
            </td>
            <td className="py-1.5">{cell(row.base, row.better === 'base')}</td>
            <td className="py-1.5">{cell(row.run, row.better === 'run')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function RunSummary({
  metrics,
  title,
  policy,
  seed,
  onReplay,
  onClose,
  baseline,
}: {
  metrics: Record<string, unknown>;
  title: string;
  policy: string;
  seed: number | null;
  onReplay: () => void;
  onClose: () => void;
  /** The reactive baseline's metrics, when it ran beside this run. */
  baseline?: { metrics: Record<string, unknown>; policy: string } | null;
}) {
  const reconnects = read(metrics, 'continuity.session_reconnects');
  const interruptions = read(metrics, 'continuity.interruptions');
  const interruptionS = read(metrics, 'continuity.total_interruption_s');
  const handovers = read(metrics, 'control_plane.handovers');
  const unnecessary = read(metrics, 'control_plane.unnecessary_handovers');
  const health = read(metrics, 'app_health_score');
  const satellite = read(metrics, 'links.satellite_bytes');
  const overhead = read(metrics, 'links.overhead_pct');

  return (
    <section
      className="glass drop-in absolute top-1/2 left-1/2 z-30 w-[min(620px,calc(100vw-48px))] -translate-x-1/2 -translate-y-1/2 px-6 pt-5 pb-5"
      role="dialog"
      aria-label="Run complete"
    >
      <button
        type="button"
        className="absolute top-3 right-3 grid h-8 w-8 place-items-center rounded-full text-[color:var(--color-faint)] hover:bg-[color:var(--color-surface-muted)] hover:text-[color:var(--color-ink)]"
        aria-label="Close run summary"
        onClick={onClose}
      >
        <CloseIcon size={15} />
      </button>
      <div className="section-label">Run complete</div>
      <h2 className="mt-1 pr-10 text-[19px] font-semibold tracking-[-0.015em]">
        {reconnects === 0 ? (
          <>
            The session held. <span className="text-[color:var(--color-good)]">No reconnects.</span>
          </>
        ) : reconnects === null ? (
          'The run finished.'
        ) : (
          <>
            The session reconnected <span className="text-[color:var(--color-bad)]">{reconnects} time{reconnects === 1 ? '' : 's'}</span>.
          </>
        )}
      </h2>
      <p className="mt-1 text-[12px] text-[color:var(--color-muted)]">
        {title} · {policy}
        {seed !== null ? ` · seed ${seed}` : ''}
        {baseline ? ` · beside the reactive baseline, ${baseline.policy}` : ''}
      </p>

      {baseline ? (
        <Comparison rows={compareRows(baseline.metrics, metrics)} basePolicy={baseline.policy} runPolicy={policy} />
      ) : (
      <div className="mt-4 grid grid-cols-3 gap-x-6 gap-y-4 border-t border-[color:var(--color-line)] pt-4">
        <Figure
          label="Session reconnects"
          value={reconnects === null ? null : String(reconnects)}
          tone={reconnects === 0 ? 'var(--color-good)' : reconnects ? 'var(--color-bad)' : undefined}
        />
        <Figure
          label="Total interruption"
          value={interruptionS === null ? null : `${interruptionS.toFixed(2)} s`}
          detail={interruptions === null ? null : `${interruptions} interruption${interruptions === 1 ? '' : 's'}`}
        />
        <Figure label="Application health" value={health === null ? null : `${health.toFixed(0)}`} detail="app_health_v1, 0-100" />
        <Figure
          label="Handovers"
          value={handovers === null ? null : String(handovers)}
          detail={unnecessary === null ? null : `${unnecessary} judged unnecessary`}
        />
        <Figure label="Satellite bytes" value={megabytes(satellite)} detail="the expensive link" />
        <Figure
          label="Overhead"
          value={overhead === null ? null : `${overhead.toFixed(1)} %`}
          detail="bytes beyond goodput"
        />
      </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2.5">
        <Link href="/decision-log" className="control control-primary no-underline">
          Open the decision log
        </Link>
        <button type="button" className="control" onClick={onReplay}>
          <ReplayIcon size={15} /> Replay this run
        </button>
        <span className="ml-auto text-[11px] text-[color:var(--color-faint)]">
          Recorded metrics · simulation, not a live network test
        </span>
      </div>
    </section>
  );
}
