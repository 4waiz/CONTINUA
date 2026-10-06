'use client';

/**
 * The end of a run, stated once: what the session went through, from the
 * metrics file the engine wrote when the run finished. Nothing here is computed
 * in the browser, and a field the file does not have says so.
 *
 * Run beside the reactive baseline, it is a paired comparison - same scenario,
 * route and seed - and the costs of acting early (handovers, overhead, bytes
 * on the expensive link) sit in the same table as the wins.
 *
 * By default it says that in words: did each rover keep its connection, how
 * long was each cut off, did either have to stop - and, in the same breath,
 * how often each changed network and what each sent over satellite, whichever
 * way those fall. The full table is under Details.
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

/** One rover's run, as a card: cut off for how long, and whether it had to stop. */
function RoverOutcome({ name, metrics, ours }: { name: string; metrics: Record<string, unknown>; ours: boolean }) {
  const lost = read(metrics, 'continuity.total_interruption_s');
  const stopped = readFlag(metrics, 'continuity.safe_stop_entered');
  const reconnects = read(metrics, 'continuity.session_reconnects');
  const kept = reconnects === 0;
  return (
    <div className="run-outcome" data-kept={reconnects === null ? undefined : String(kept)}>
      <div className="run-outcome-name" style={{ color: ours ? 'var(--color-blue)' : 'var(--color-muted)' }}>
        {name}
      </div>
      <div className="run-outcome-state">
        {reconnects === null ? 'unavailable' : kept ? 'Kept its connection' : `Lost it ${reconnects} time${reconnects === 1 ? '' : 's'}`}
      </div>
      <div className="run-outcome-detail">
        {lost === null ? 'time offline unavailable' : `${lost.toFixed(1)} s without a link`}
        {stopped === null ? '' : stopped ? ' · had to stop' : ' · never had to stop'}
      </div>
    </div>
  );
}

/** "2.5× less" when ours is lower, "1.8× more" when higher; nothing below the floor or under 1.5×. */
function ratioWords(ours: number | null, theirs: number | null, floor: number): { text: string; ours: boolean } | null {
  if (ours === null || theirs === null || Math.min(ours, theirs) < floor) return null;
  const high = Math.max(ours, theirs);
  const low = Math.min(ours, theirs);
  if (high / low < 1.5) return null;
  const factor = high / low < 10 ? (high / low).toFixed(1) : (high / low).toFixed(0);
  return ours < theirs ? { text: `${factor}× less`, ours: true } : { text: `${factor}× more`, ours: false };
}

interface Versus {
  label: string;
  why: string;
  ours: number | null;
  theirs: number | null;
  format: (value: number) => string;
  floor: number;
}

const secondsText = (value: number): string => (value < 10 ? `${value.toFixed(1)} s` : `${value.toFixed(0)} s`);
const percentText = (value: number): string => `${value < 10 ? value.toFixed(1) : value.toFixed(0)} %`;
const sizeText = (megabytes: number): string =>
  megabytes < 1 ? `${(megabytes * 1000).toFixed(0)} KB` : megabytes < 100 ? `${megabytes.toFixed(1)} MB` : `${megabytes.toFixed(0)} MB`;

/** One measured row of the ending: the two values, the shorter bar the better, and how far apart. */
function VersusRow({ row, mainName }: { row: Versus; mainName: string }) {
  const max = Math.max(row.ours ?? 0, row.theirs ?? 0);
  const width = (value: number | null) => (value === null || max <= 0 ? 0 : Math.max(1.5, (value / max) * 100));
  const ratio = ratioWords(row.ours, row.theirs, row.floor);
  return (
    <li className="ending-row" title={row.why}>
      <span className="ending-label">{row.label}</span>
      <span className="ending-cell" data-side="main">
        <span className="ending-track" aria-hidden>
          <span className="ending-fill" style={{ width: `${width(row.ours)}%` }} />
        </span>
        <span className="ending-value metric">{row.ours === null ? 'unavailable' : row.format(row.ours)}</span>
      </span>
      <span className="ending-cell" data-side="base">
        <span className="ending-track" aria-hidden>
          <span className="ending-fill" style={{ width: `${width(row.theirs)}%` }} />
        </span>
        <span className="ending-value metric">{row.theirs === null ? 'unavailable' : row.format(row.theirs)}</span>
      </span>
      <span className="ending-ratio" data-better={ratio ? (ratio.ours ? 'main' : 'base') : undefined}>
        {ratio ? `${mainName} ${ratio.text}` : ''}
      </span>
    </li>
  );
}

/**
 * The run's ending, side by side: did each rover keep its connection, then
 * what each operator lived through - frozen video, late steering, the costly
 * link - and, in the same table, what acting early cost CONTINUA.
 */
function SimpleSummary({
  metrics,
  mainName,
  baseline,
  proof,
}: {
  metrics: Record<string, unknown>;
  mainName: string;
  baseline: Record<string, unknown> | null;
  proof: string | null;
}) {
  if (!baseline) {
    const changes = read(metrics, 'control_plane.handovers');
    const satellite = megabytes(read(metrics, 'links.satellite_bytes'));
    return (
      <>
        <div className="mt-4 grid grid-cols-1 gap-3">
          <RoverOutcome name={mainName} metrics={metrics} ours />
        </div>
        <p className="mt-3 text-[12.5px] leading-snug text-[color:var(--color-muted)]">
          Along the way:{' '}
          {[
            changes === null ? null : `${changes} change${changes === 1 ? '' : 's'} of network`,
            satellite === null ? null : `${satellite} over satellite, the costly link`,
          ]
            .filter(Boolean)
            .join(' and ')}
          .
        </p>
      </>
    );
  }
  const stall = (source: Record<string, unknown>) => {
    const ms = read(source, 'application.video.stall_ms');
    return ms === null ? null : ms / 1000;
  };
  const satellite = (source: Record<string, unknown>) => {
    const bytes = read(source, 'links.satellite_bytes');
    return bytes === null ? null : bytes / 1e6;
  };
  const measured: Versus[] = [
    {
      label: 'Time without a link',
      why: "Seconds the operator could not reach the rover at all, from the receiver's report - the session's first fifth of a second included, the same for both.",
      ours: read(metrics, 'continuity.total_interruption_s'),
      theirs: read(baseline, 'continuity.total_interruption_s'),
      format: secondsText,
      floor: 1,
    },
    {
      label: 'Video frozen',
      why: "Seconds the operator's camera picture was stalled.",
      ours: stall(metrics),
      theirs: stall(baseline),
      format: secondsText,
      floor: 1,
    },
    {
      label: 'Steering commands late',
      why: 'Share of steering commands that arrived after their deadline, or could not be sent at all.',
      ours: read(metrics, 'application.control.deadline_miss_pct'),
      theirs: read(baseline, 'application.control.deadline_miss_pct'),
      format: percentText,
      floor: 1,
    },
    {
      label: 'Data over satellite',
      why: 'Everything sent over the satellite link, the slow and costly one.',
      ours: satellite(metrics),
      theirs: satellite(baseline),
      format: sizeText,
      floor: 0.5,
    },
  ];
  const changes = [read(metrics, 'control_plane.handovers'), read(baseline, 'control_plane.handovers')] as const;
  const uploads = [read(metrics, 'application.bulk.completion_pct'), read(baseline, 'application.bulk.completion_pct')] as const;
  return (
    <>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <RoverOutcome name={mainName} metrics={metrics} ours />
        <RoverOutcome name="Normal rover" metrics={baseline} ours={false} />
      </div>
      <ul className="ending-rows" aria-label="What each operator lived through">
        <li className="ending-row ending-row-head" aria-hidden>
          <span />
          <span className="ending-name" data-side="main">
            {mainName}
          </span>
          <span className="ending-name" data-side="base">
            Normal rover
          </span>
          <span />
        </li>
        {measured.map((row) => (
          <VersusRow key={row.label} row={row} mainName={mainName} />
        ))}
      </ul>
      <p className="ending-cost">
        <span className="ending-cost-label">What acting early cost</span>
        {changes[0] !== null && changes[1] !== null && (
          <span>
            {changes[0]} changes of network (normal rover: {changes[1]})
          </span>
        )}
        {uploads[0] !== null && uploads[1] !== null && (
          <span>
            {uploads[0].toFixed(0)} % of big uploads finished (normal rover: {uploads[1].toFixed(0)} %) - held back to keep steering and video
            moving
          </span>
        )}
      </p>
      {proof && <p className="ending-proof">{proof}</p>}
    </>
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
  simple = false,
  mainName = 'CONTINUA',
  proof = null,
}: {
  metrics: Record<string, unknown>;
  title: string;
  policy: string;
  seed: number | null;
  onReplay: () => void;
  onClose: () => void;
  /** The reactive baseline's metrics, when it ran beside this run. */
  baseline?: { metrics: Record<string, unknown>; policy: string } | null;
  /** In words, the table left to Details. */
  simple?: boolean;
  /** This run's rover, as the status cards name it. */
  mainName?: string;
  /** What the stored twenty-drive comparison found, for the run it was made on. */
  proof?: string | null;
}) {
  const reconnects = read(metrics, 'continuity.session_reconnects');
  const interruptions = read(metrics, 'continuity.interruptions');
  const interruptionS = read(metrics, 'continuity.total_interruption_s');
  const handovers = read(metrics, 'control_plane.handovers');
  const unnecessary = read(metrics, 'control_plane.unnecessary_handovers');
  const health = read(metrics, 'app_health_score');
  const satellite = read(metrics, 'links.satellite_bytes');
  const overhead = read(metrics, 'links.overhead_pct');
  const baselineLost = baseline ? read(baseline.metrics, 'continuity.session_reconnects') : null;
  const baselineStopped = baseline ? readFlag(baseline.metrics, 'continuity.safe_stop_entered') : null;

  return (
    <section
      className={`glass drop-in run-summary absolute top-[calc((100%-var(--dock-h)-var(--edge))/2)] left-1/2 z-30 -translate-x-1/2 -translate-y-1/2 px-6 pt-5 pb-5 ${simple && baseline ? 'w-[min(760px,calc(100vw-48px))]' : 'w-[min(620px,calc(100vw-48px))]'}`}
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
        {reconnects === null ? (
          'The run finished.'
        ) : simple ? (
          reconnects === 0 ? (
            <>
              {mainName} <span className="text-[color:var(--color-good)]">kept its connection the whole way.</span>
              {baselineLost !== null && baselineLost > 0 && (
                <span className="mt-0.5 block text-[15px] font-semibold text-[color:var(--color-muted)]">
                  The normal rover lost it {baselineLost === 1 ? 'once' : `${baselineLost} times`}
                  {baselineStopped ? ' and had to stop.' : '.'}
                </span>
              )}
            </>
          ) : (
            <>
              {mainName} <span className="text-[color:var(--color-bad)]">lost its connection {reconnects} time{reconnects === 1 ? '' : 's'}</span>.
            </>
          )
        ) : reconnects === 0 ? (
          <>
            The session held. <span className="text-[color:var(--color-good)]">No reconnects.</span>
          </>
        ) : (
          <>
            The session reconnected <span className="text-[color:var(--color-bad)]">{reconnects} time{reconnects === 1 ? '' : 's'}</span>.
          </>
        )}
      </h2>
      <p className="mt-1 text-[12px] text-[color:var(--color-muted)]">
        {simple
          ? `${title}${baseline ? ' · the same road, signal and moment for both rovers' : ''}`
          : `${title} · ${policy}${seed !== null ? ` · seed ${seed}` : ''}${baseline ? ` · beside the reactive baseline, ${baseline.policy}` : ''}`}
      </p>

      {simple ? (
        <SimpleSummary metrics={metrics} mainName={mainName} baseline={baseline?.metrics ?? null} proof={proof} />
      ) : baseline ? (
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
