'use client';

/**
 * The application shell: one slim top bar - brand, navigation, run identity -
 * and one region underneath that each page lays itself out inside.
 *
 * Two things here are load-bearing rather than decorative.
 *
 * **The identity chips.** Execution mode, connection state and run id must be
 * visible at all times, in the dashboard and in exported evidence, so nobody
 * can mistake a simulation for a live network test or a replay for a fresh
 * run. They live in the top bar, not tucked into a panel.
 *
 * **The fixed height.** `.app-shell` is exactly one viewport tall and does not
 * scroll. Anything unbounded (a decision log, a results table) scrolls inside
 * its own region. A dashboard the operator has to scroll is a dashboard that
 * hides the thing that just changed.
 */

import type { ConnectionState } from '@/lib/useEngineRun';
import type { EngineRunState } from '@continua/contracts/engine';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { IS_PUBLIC_PREVIEW } from '@/lib/deployment';
import { useRegisteredTour } from './onboarding/tourStore';
import { GuideIcon } from './ui/icons';
import { Chip, Dot } from './ui/primitives';

/**
 * Six places, named for what a visitor wants from each: watch or drive the
 * mission, see the results, read every decision, build a scenario of their
 * own, see how the challenge's brief is answered, and who made it. The Scene
 * Lab - a workbench for the 3D world itself - is still at /scene-lab, linked
 * from the Scenario builder, but no longer in the way.
 */
const NAV = [
  { href: '/', label: 'Mission' },
  { href: '/experiments', label: 'Results' },
  { href: '/decision-log', label: 'Decision log' },
  { href: '/scenario-lab', label: 'Scenario builder' },
  { href: '/challenge', label: 'The brief' },
  { href: '/credits', label: 'Credits' },
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
  if (IS_PUBLIC_PREVIEW && connection !== 'error') {
    // There is no engine at the other end of anything here, so "CONNECTED"
    // would be a lie told with a green pulsing dot. What is actually happening
    // is playback of a run that shipped with the page.
    return (
      <Chip
        tone="violet"
        title="Playing a run recorded by the CONTINUA engine and bundled with this page. No engine connection exists on the public site."
      >
        RECORDED
      </Chip>
    );
  }
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

function statusOf(state: EngineRunState | null): { label: string; tone: 'good' | 'warn' | 'muted' } {
  if (!state) return { label: 'READY', tone: 'muted' };
  if (state.status === 'running') return { label: 'RUNNING', tone: 'good' };
  if (state.status === 'completed') return { label: 'COMPLETE', tone: 'muted' };
  return { label: state.status.toUpperCase(), tone: 'warn' };
}

/**
 * Run identity for the top bar: mode, connection, run id and status in one
 * compact group, plus an optional action slot. The scenario and policy are on
 * the controls that chose them, so they are not repeated here.
 */
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
    <div className="flex min-w-0 items-center gap-3">
      <div className="flex items-center gap-2">
        <ModeBadge state={state} />
        {/* A connection badge with nothing to connect to is noise. */}
        {!(IS_PUBLIC_PREVIEW && !state) && (
          <ConnectionBadge connection={connection} stale={stale} dropped={dropped} />
        )}
      </div>
      {state && (
        <div className="hidden min-w-0 flex-col leading-tight 2xl:flex">
          <span
            className="metric truncate font-[family-name:var(--font-mono)] text-[12px] font-semibold"
            title={`Run ${state.run_id} · seed ${state.seed} · ${state.scenario_title || state.scenario_id} · ${state.policy_id}`}
          >
            {state.run_id}
          </span>
          <span
            className="text-[11px] font-semibold tracking-[0.06em]"
            style={{ color: status.tone === 'good' ? 'var(--color-good)' : 'var(--color-faint)' }}
          >
            {status.label} · SEED {state.seed}
          </span>
        </div>
      )}
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Kept for pages that show identity inline rather than in the bar. */
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
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex items-center gap-2.5">
        <ModeBadge state={state} />
        <ConnectionBadge connection={connection} stale={stale} dropped={dropped} />
      </div>
      {state && (
        <span className="metric font-[family-name:var(--font-mono)] text-[12px] text-[color:var(--color-muted)]">
          {state.run_id} · seed {state.seed} · {state.policy_id}
        </span>
      )}
    </div>
  );
}

/** The brand lockup: supplied wordmark, product line, team. */
export function BrandHeader({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="flex shrink-0 items-center gap-3 no-underline" aria-label="CONTINUA home">
      <span aria-hidden className="h-[30px] w-[3px] shrink-0 rounded-full" style={{ background: 'var(--brand-gradient)' }} />
      {/* The supplied wordmark, un-matted to alpha by `scripts/build-brand-logo.mjs`.
          It stays inside the h1: the document keeps a level-one heading, and
          its text is the image's alt. */}
      <h1 className="m-0 leading-none">
        <Image
          src="/brand/continua-logo.png"
          alt="CONTINUA"
          width={560}
          height={61}
          priority
          className={compact ? 'h-[16px] w-auto' : 'h-[19px] w-auto 2xl:h-[22px]'}
        />
      </h1>
      <div className="flex flex-col justify-center gap-[3px] leading-none">
        <span className="whitespace-nowrap text-[12.5px] font-semibold text-[color:var(--color-ink)]">
          Predictive Network Continuity
        </span>
        <span className="whitespace-nowrap text-[11.5px] font-semibold text-[color:var(--color-blue)]">by Team Kanban</span>
      </div>
    </Link>
  );
}

/** The way back into the page's tour, whenever it has one. */
function GuideButton() {
  const tour = useRegisteredTour();
  if (!tour) return null;
  return (
    <button
      type="button"
      className="guide-btn"
      onClick={tour.start}
      title="A short guided tour of this page: what each panel shows and where to click"
    >
      <GuideIcon size={15} /> Guide
    </button>
  );
}

export function TopBar({ right }: { right?: ReactNode }) {
  const pathname = usePathname();
  return (
    <header className="topbar">
      <BrandHeader />
      <nav aria-label="Sections" className="seg mx-auto">
        {NAV.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className="seg-item no-underline"
              data-active={active}
              aria-current={active ? 'page' : undefined}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="flex min-w-0 shrink-0 items-center justify-end gap-3">
        <GuideButton />
        {right}
      </div>
    </header>
  );
}

/**
 * @param bar      run identity and actions, rendered on the right of the top bar
 * @param variant  `immersive` gives the page the whole region edge to edge (the
 *                 scene views); `page` pads it for document-style pages.
 * @param children exactly one region; it gets the remaining height
 */
export function AppShell({
  children,
  bar,
  variant = 'page',
}: {
  children: ReactNode;
  bar?: ReactNode;
  variant?: 'page' | 'immersive';
}) {
  return (
    <div className="app-shell">
      <TopBar right={bar} />
      <main className={variant === 'immersive' ? 'app-main-immersive' : 'app-main-page'}>{children}</main>
    </div>
  );
}
