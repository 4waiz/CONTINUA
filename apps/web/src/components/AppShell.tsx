'use client';

/**
 * The application shell: brand, navigation, and the global run bar.
 *
 * Two things here are load-bearing rather than decorative.
 *
 * **The identity strip.** Execution mode, scenario, run id and connection state
 * must be visible at all times, in the dashboard and in exported evidence, so
 * nobody can mistake a simulation for a live network test or a replay for a
 * fresh run. It is in the run bar, not tucked into a corner.
 *
 * **The fixed height.** `.app-shell` is exactly one viewport tall and does not
 * scroll. Pages receive a single flex child and are expected to lay themselves
 * out inside it; anything unbounded (a decision log, a results table) scrolls
 * within its own panel. A dashboard the operator has to scroll is a dashboard
 * that hides the thing that just changed.
 */

import type { ConnectionState } from '@/lib/useEngineRun';
import type { EngineRunState } from '@continua/contracts/engine';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { IS_PUBLIC_PREVIEW } from '@/lib/deployment';
import { Chip, Dot } from './ui/primitives';

const NAV = [
  { href: '/', label: 'Mission' },
  { href: '/scenario-lab', label: 'Scenario Lab' },
  { href: '/experiments', label: 'Experiments' },
  { href: '/decision-log', label: 'Decision Log' },
  { href: '/scene-lab', label: 'Scene Lab' },
] as const;

export function ModeBadge({ state }: { state: EngineRunState | null }) {
  if (!state) {
    // The public build has no engine to run anything, so "NO RUN" would read as
    // a state waiting to change. It is not going to change.
    return IS_PUBLIC_PREVIEW ? (
      <Chip tone="blue" title="A static build of the CONTINUA interface. The simulation engine is Python and runs locally.">
        PUBLIC PREVIEW
      </Chip>
    ) : (
      <Chip tone="muted">NO RUN</Chip>
    );
  }
  if (state.mode === 'replay') {
    const source = state.source;
    return (
      <Chip
        tone="violet"
        title={`Replay of ${source?.run_id ?? 'unknown run'} recorded ${source?.recorded_at ?? 'unknown time'} in ${source?.mode ?? 'unknown'} mode`}
      >
        REPLAY · {source?.mode?.toUpperCase() ?? ' - '}
      </Chip>
    );
  }
  if (state.mode === 'emulation') {
    return <Chip tone="good">EMULATION</Chip>;
  }
  return (
    <Chip tone="warn" title="A deterministic software network model. Not a live mobile-network test.">
      SIMULATION
    </Chip>
  );
}

export function ConnectionBadge({
  connection,
  stale,
  dropped,
}: {
  connection: ConnectionState;
  stale: boolean;
  dropped: number;
}) {
  if (connection === 'connected' && stale) {
    return (
      <Chip tone="warn" title="Connected, but no engine message has arrived recently. Values shown are the last received, not current.">
        <Dot color="var(--color-warn)" /> STALE
      </Chip>
    );
  }
  const map: Record<ConnectionState, { tone: 'good' | 'muted' | 'bad' | 'warn'; label: string }> = {
    idle: { tone: 'muted', label: 'IDLE' },
    connecting: { tone: 'warn', label: 'CONNECTING' },
    connected: { tone: 'good', label: 'CONNECTED' },
    disconnected: { tone: 'bad', label: 'DISCONNECTED' },
    error: { tone: 'bad', label: 'ERROR' },
  };
  const entry = map[connection];
  return (
    <Chip tone={entry.tone} title={dropped > 0 ? `${dropped} event(s) missed during a reconnect` : undefined}>
      <Dot
        color={`var(--color-${entry.tone === 'good' ? 'good' : entry.tone === 'bad' ? 'bad' : 'warn'})`}
        pulse={connection === 'connected' && !stale}
      />
      {entry.label}
      {dropped > 0 ? ` · ${dropped} gap` : ''}
    </Chip>
  );
}

/** One labelled fact in the run bar. Small label above, readable value below. */
function RunFact({ label, value, mono = false }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col leading-tight">
      <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-[color:var(--color-faint)]">
        {label}
      </span>
      <span
        className={`metric truncate text-[13.5px] font-semibold ${mono ? 'font-[family-name:var(--font-mono)] text-[12.5px]' : ''}`}
      >
        {value}
      </span>
    </div>
  );
}

function statusOf(state: EngineRunState | null): { label: string; tone: 'good' | 'warn' | 'muted' } {
  if (!state) return { label: 'READY', tone: 'muted' };
  if (state.status === 'running') return { label: 'RUNNING', tone: 'good' };
  if (state.status === 'completed') return { label: 'COMPLETE', tone: 'muted' };
  return { label: state.status.toUpperCase(), tone: 'warn' };
}

export function RunStatusBar({
  state,
  connection,
  stale,
  dropped,
  actions,
}: {
  state: EngineRunState | null;
  connection: ConnectionState;
  stale: boolean;
  dropped: number;
  actions?: ReactNode;
}) {
  const status = statusOf(state);
  return (
    <div className="panel flex flex-wrap items-center gap-x-6 gap-y-2.5 px-5 py-3">
      <div className="flex items-center gap-2.5">
        <ModeBadge state={state} />
        {/* A connection badge with nothing to connect to is noise. */}
        {!(IS_PUBLIC_PREVIEW && !state) && (
          <ConnectionBadge connection={connection} stale={stale} dropped={dropped} />
        )}
      </div>

      <div className="h-8 w-px shrink-0 bg-[color:var(--color-line)]" />

      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-7 gap-y-2">
        <RunFact label="Status" value={<span className={status.tone === 'good' ? 'text-[color:var(--color-good)]' : undefined}>{status.label}</span>} />
        <RunFact label="Scenario" value={state?.scenario_title || state?.scenario_id || ' - '} />
        <RunFact label="Policy" value={state?.policy_id ? `${state.policy_id}${state.policy_id === 'P1' ? ' · CONTINUA' : ''}` : ' - '} />
        <RunFact label="Run" value={state?.run_id ?? ' - '} mono />
        <RunFact label="Seed" value={state?.seed ?? ' - '} mono />
      </div>

      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * Kept for the pages that have not moved to `RunStatusBar` yet. Same facts,
 * laid out inline.
 */
export function RunIdentity({
  state,
  connection,
  stale,
  dropped,
}: {
  state: EngineRunState | null;
  connection: ConnectionState;
  stale: boolean;
  dropped: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
      <div className="flex items-center gap-2.5">
        <ModeBadge state={state} />
        <ConnectionBadge connection={connection} stale={stale} dropped={dropped} />
      </div>
      <div className="flex flex-wrap items-center gap-x-7 gap-y-2">
        <RunFact label="Scenario" value={state?.scenario_title || state?.scenario_id || ' - '} />
        <RunFact label="Policy" value={state?.policy_id ?? ' - '} />
        <RunFact label="Run" value={state?.run_id ?? ' - '} mono />
        <RunFact label="Seed" value={state?.seed ?? ' - '} mono />
      </div>
    </div>
  );
}

export function BrandHeader() {
  const pathname = usePathname();
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <Link href="/" className="flex items-stretch gap-3.5 no-underline">
        <span
          aria-hidden
          className="w-[4px] shrink-0 rounded-full"
          style={{ background: 'var(--brand-gradient)' }}
        />
        <div className="leading-none">
          <h1 className="brand-text text-[clamp(28px,2.2vw,36px)] font-semibold leading-[1.02] tracking-[-0.035em]">
            CONTINUA
          </h1>
          <p className="mt-[7px] text-[14px] font-medium leading-none text-[color:var(--color-ink)]">
            Predictive Network Continuity
          </p>
          <p className="mt-[5px] text-[12.5px] leading-none text-[color:var(--color-muted)]">
            <span className="font-semibold text-[color:var(--color-blue)]">by Team Kanban</span>
            <span className="mx-1.5 text-[color:var(--color-line-strong)]">·</span>
            The network changes. The session doesn&rsquo;t.
          </p>
        </div>
      </Link>

      <nav aria-label="Sections" className="flex flex-wrap items-center gap-1">
        {NAV.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className="nav-pill no-underline"
              data-active={active}
              aria-current={active ? 'page' : undefined}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}

/**
 * @param bar   the global run bar, rendered directly under the header
 * @param children  exactly one flex/grid region; it gets the remaining height
 */
export function AppShell({ children, bar }: { children: ReactNode; bar?: ReactNode }) {
  return (
    <div className="app-shell">
      <BrandHeader />
      {bar ?? <div />}
      <main className="min-h-0">{children}</main>
    </div>
  );
}
