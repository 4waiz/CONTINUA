'use client';

/**
 * The end of a run, stated once: what the session went through, from the
 * metrics file the engine wrote when the run finished. Nothing here is computed
 * in the browser, and a field the file does not have says so.
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

export function RunSummary({
  metrics,
  title,
  policy,
  seed,
  onReplay,
  onClose,
}: {
  metrics: Record<string, unknown>;
  title: string;
  policy: string;
  seed: number | null;
  onReplay: () => void;
  onClose: () => void;
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
      </p>

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
