'use client';

/**
 * Header, navigation and the run-identity strip.
 *
 * The identity strip is not decoration: execution mode, scenario, run id and
 * connection state must be visible at all times, in the dashboard and in
 * exported evidence, so nobody can mistake a simulation for a live network
 * test or a replay for a fresh run.
 */

import type { ConnectionState } from '@/lib/useEngineRun';
import type { EngineRunState } from '@continua/contracts/engine';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Chip, Dot } from './ui/primitives';

const NAV = [
  { href: '/', label: 'Mission' },
  { href: '/scenario-lab', label: 'Scenario Lab' },
  { href: '/experiments', label: 'Experiments' },
  { href: '/decision-log', label: 'Decision Log' },
] as const;

export function ModeBadge({ state }: { state: EngineRunState | null }) {
  if (!state) {
    return <Chip tone="muted">NO RUN</Chip>;
  }
  if (state.mode === 'replay') {
    const source = state.source;
    return (
      <Chip
        tone="violet"
        title={`Replay of ${source?.run_id ?? 'unknown run'} recorded ${source?.recorded_at ?? 'unknown time'} in ${source?.mode ?? 'unknown'} mode`}
      >
        REPLAY · {source?.mode?.toUpperCase() ?? '—'}
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
      <Dot color={`var(--color-${entry.tone === 'good' ? 'good' : entry.tone === 'bad' ? 'bad' : 'warn'})`} pulse={connection === 'connected' && !stale} />
      {entry.label}
      {dropped > 0 ? ` · ${dropped} gap` : ''}
    </Chip>
  );
}

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
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      <ModeBadge state={state} />
      <ConnectionBadge connection={connection} stale={stale} dropped={dropped} />
      <dl className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[11px]">
        <div className="flex items-baseline gap-1.5">
          <dt className="text-[color:var(--color-muted)]">Scenario</dt>
          <dd className="font-semibold">{state?.scenario_title || state?.scenario_id || '—'}</dd>
        </div>
        <div className="flex items-baseline gap-1.5">
          <dt className="text-[color:var(--color-muted)]">Policy</dt>
          <dd className="font-semibold">{state?.policy_id ?? '—'}</dd>
        </div>
        <div className="flex items-baseline gap-1.5">
          <dt className="text-[color:var(--color-muted)]">Run</dt>
          <dd className="metric font-[family-name:var(--font-mono)]">{state?.run_id ?? '—'}</dd>
        </div>
        <div className="flex items-baseline gap-1.5">
          <dt className="text-[color:var(--color-muted)]">Seed</dt>
          <dd className="metric font-[family-name:var(--font-mono)]">{state?.seed ?? '—'}</dd>
        </div>
      </dl>
    </div>
  );
}

export function AppShell({
  children,
  identity,
  actions,
}: {
  children: ReactNode;
  identity?: ReactNode;
  actions?: ReactNode;
}) {
  const pathname = usePathname();
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1800px] flex-col gap-3 p-3 lg:p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-stretch gap-3">
          <span
            aria-hidden
            className="w-[3px] shrink-0 rounded-full"
            style={{ background: 'linear-gradient(180deg,#176BFF,#7C3CFF)' }}
          />
          <div>
            <h1
              className="text-[clamp(22px,2.6vw,34px)] font-semibold leading-none tracking-[-0.03em]"
              style={{
                background: 'linear-gradient(96deg,#176BFF 8%,#5B4BFF 52%,#7C3CFF 92%)',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                color: 'transparent',
              }}
            >
              CONTINUA
            </h1>
            <p className="mt-0.5 text-[13px] font-medium leading-tight">Predictive Network Continuity</p>
            <p className="text-[11.5px] text-[color:var(--color-muted)]">
              <span style={{ color: 'var(--color-blue)' }}>by Team Kanban</span> · The network changes.
              The session doesn’t.
            </p>
          </div>
        </div>

        <nav aria-label="Sections" className="flex flex-wrap items-center gap-1.5">
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="control"
                data-active={active}
                aria-current={active ? 'page' : undefined}
              >
                {item.label}
              </Link>
            );
          })}
          <Link className="control" href="/scene-lab" title="Phase 1 scene inspector">
            Scene Lab
          </Link>
        </nav>
      </header>

      {(identity || actions) && (
        <div className="panel flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5">
          {identity}
          {actions && <div className="flex flex-wrap items-center gap-1.5">{actions}</div>}
        </div>
      )}

      {children}

      <footer className="pb-1 text-center text-[10.5px] text-[color:var(--color-muted)]">
        Phase 2 — application-aware connectivity prototype. Figures are produced by a deterministic
        software network model unless the mode badge says otherwise. Emulation and MPTCP status:{' '}
        <Link className="underline" href="/experiments#capability">
          see capability report
        </Link>
        .
      </footer>
    </div>
  );
}
