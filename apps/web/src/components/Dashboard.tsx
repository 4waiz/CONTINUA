'use client';

/**
 * The CONTINUA dashboard frame — the light-mode composition from the reference,
 * with the real 3D scene as its centrepiece.
 *
 * Every number on this page is derived from the scene's own state. Where the
 * reference shows signal strength in dBm, latency in ms and packet loss as a
 * percentage, Phase 1 has no engine to measure them, so those panels show the
 * quantities we *do* have — modelled coverage, route progress, planned
 * handoffs — and the page is stamped SCENE PREVIEW.
 */

import {
  ACCESS_NETWORK_META,
  ACCESS_NETWORKS,
  type AccessNetworkId,
} from '@continua/contracts';
import { MISSION_ZONES, NETWORK_COLOR, useThrottledSceneState } from '@continua/scene';
import { LinkFan } from './LinkFan';
import { SceneStage } from './SceneStage';
import { Chip, Dot, Panel, PreviewBadge, Stat } from './ui/primitives';

const FEATURES = [
  { title: 'AI Prediction', body: 'Anticipates changes.' },
  { title: 'Smart Handoff', body: 'Zero-session drop.' },
  { title: 'Policy Driven', body: 'QoS always on.' },
  { title: 'Secure by Design', body: 'End-to-end trust.' },
] as const;

function CoverageBar({ id, coverage, state }: { id: AccessNetworkId; coverage: number; state: string }) {
  const meta = ACCESS_NETWORK_META[id];
  const carrying = state === 'active' || state === 'degraded';
  return (
    <li className="flex items-center gap-2">
      <span className="w-[64px] shrink-0 text-[11.5px] font-semibold" style={{ color: NETWORK_COLOR[id] }}>
        {meta.label}
      </span>
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[color:var(--color-line)]">
        <span
          className="block h-full rounded-full transition-[width] duration-300"
          style={{ width: `${Math.max(2, coverage * 100)}%`, background: NETWORK_COLOR[id] }}
        />
      </span>
      <span className="metric w-[34px] shrink-0 text-right text-[11px] text-[color:var(--color-muted)]">
        {(coverage * 100).toFixed(0)}%
      </span>
      {carrying && <Dot color={NETWORK_COLOR[id]} />}
    </li>
  );
}

export function Dashboard() {
  const state = useThrottledSceneState(220);
  const progress = state.duration > 0 ? state.simTime / state.duration : 0;
  const activeMeta = state.active ? ACCESS_NETWORK_META[state.active] : null;

  return (
    <main className="mx-auto w-full max-w-[1720px] p-3 lg:p-5">
      {/* ---------------- header ---------------- */}
      <header className="mb-3 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-stretch gap-4">
          <span
            aria-hidden
            className="w-[3px] rounded-full"
            style={{ background: 'linear-gradient(180deg,#176BFF,#7C3CFF)' }}
          />
          <div>
            <h1
              className="text-[clamp(30px,4vw,52px)] font-semibold leading-[0.98] tracking-[-0.035em]"
              style={{
                background: 'linear-gradient(96deg,#176BFF 8%,#5B4BFF 52%,#7C3CFF 92%)',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                color: 'transparent',
              }}
            >
              CONTINUA
            </h1>
            <p className="mt-0.5 text-[clamp(15px,1.5vw,22px)] font-medium leading-tight text-[color:var(--color-ink)]">
              Predictive Network Continuity
            </p>
            <p className="mt-1 text-[12.5px] font-medium" style={{ color: 'var(--color-blue)' }}>
              by Team Kanban
            </p>
            <p className="mt-0.5 text-[13px] text-[color:var(--color-ink)]">
              The network changes. The session{' '}
              <span className="font-semibold" style={{ color: 'var(--color-blue)' }}>
                doesn’t.
              </span>
            </p>
          </div>
        </div>

        <div className="panel flex flex-wrap items-center gap-x-7 gap-y-2 px-4 py-3">
          <div className="flex items-center gap-2">
            <Dot color="var(--color-good)" pulse />
            <span className="panel-label">Run status</span>
          </div>
          <Stat label="Session" value="Continuous" tone="var(--color-good)" />
          <Stat label="Handoffs" value={String(state.traffic.handoffCount)} />
          <Stat label="Route" value={`${(progress * 100).toFixed(0)}`} unit="%" />
          <PreviewBadge source={state.source} />
        </div>
      </header>

      {/* ---------------- body ---------------- */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[290px_minmax(0,1fr)_312px]">
        {/* left rail */}
        <div className="flex flex-col gap-3">
          <Panel title="Modelled coverage">
            <ul className="space-y-2">
              {ACCESS_NETWORKS.map((id) => (
                <CoverageBar key={id} id={id} coverage={state.links[id].coverage} state={state.links[id].state} />
              ))}
            </ul>
            <p className="mt-2.5 text-[10.5px] leading-snug text-[color:var(--color-muted)]">
              Geometric coverage from distance to infrastructure. Not a measured signal level — a live
              engine arrives in Phase&nbsp;2.
            </p>
          </Panel>

          <Panel title="Route progress">
            <Stat label="Distance travelled" value={state.vehicle.distance.toFixed(0)} unit="m" />
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[color:var(--color-line)]">
              <div
                className="h-full rounded-full transition-[width] duration-300"
                style={{
                  width: `${progress * 100}%`,
                  background: 'linear-gradient(90deg,#12B9E8,#176BFF 55%,#7C3CFF)',
                }}
              />
            </div>
            <ul className="mt-3 space-y-1">
              {MISSION_ZONES.map((zone) => (
                <li key={zone.id} className="flex items-center justify-between gap-2 text-[11.5px]">
                  <span
                    className={
                      zone.id === state.zone
                        ? 'font-semibold text-[color:var(--color-ink)]'
                        : 'text-[color:var(--color-muted)]'
                    }
                  >
                    {zone.label}
                  </span>
                  {zone.id === state.zone && <Chip tone="blue">Current</Chip>}
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Rover">
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Speed" value={(state.vehicle.speedMps * 3.6).toFixed(0)} unit="km/h" />
              <Stat label="Heading" value={`${((state.vehicle.heading * 180) / Math.PI).toFixed(0)}°`} />
            </div>
            <p className="mt-2 text-[10.5px] text-[color:var(--color-muted)]">
              CONTINUA Rover Mk1 · inspection unit 04
            </p>
          </Panel>
        </div>

        {/* centre stage */}
        <div className="flex flex-col gap-3">
          <Panel dense>
            <div className="mb-1 flex items-center justify-between gap-3 px-1">
              <h2 className="text-[13.5px] font-semibold tracking-[-0.01em]" style={{ color: 'var(--color-blue)' }}>
                ALTERNATIVE ACCESS LINKS — ONE SESSION
              </h2>
              {activeMeta && (
                <Chip tone={activeMeta.accent === 'violet' ? 'violet' : activeMeta.accent === 'blue' ? 'blue' : 'cyan'}>
                  Carrying: {activeMeta.label}
                </Chip>
              )}
            </div>
            <LinkFan state={state} />
          </Panel>

          <SceneStage className="min-h-[44vh] flex-1 xl:min-h-[54vh]" />

          <div className="panel flex flex-wrap items-center justify-center gap-x-2 gap-y-1 px-4 py-2.5 text-[14px]">
            <span className="font-semibold" style={{ color: 'var(--color-cyan)' }}>
              Seamless.
            </span>
            <span className="font-medium">Intelligent.</span>
            <span className="font-semibold" style={{ color: 'var(--color-violet)' }}>
              Uninterrupted.
            </span>
          </div>
        </div>

        {/* right rail */}
        <div className="flex flex-col gap-3">
          <Panel title="Active link" action={<PreviewBadge source={state.source} />}>
            {activeMeta ? (
              <>
                <div className="flex items-baseline gap-2">
                  <span
                    className="text-[26px] font-semibold leading-none"
                    style={{ color: NETWORK_COLOR[activeMeta.id] }}
                  >
                    {activeMeta.label}
                  </span>
                  <span className="text-[12px] text-[color:var(--color-muted)]">{activeMeta.sublabel}</span>
                </div>
                <p className="mt-1.5 text-[11.5px] text-[color:var(--color-muted)]">
                  {state.links[activeMeta.id].state === 'degraded'
                    ? 'Below target — a replacement is already pre-warming.'
                    : 'Carrying the session.'}
                </p>
              </>
            ) : (
              <p className="text-[12px] text-[color:var(--color-muted)]">No link selected yet.</p>
            )}
            {state.warming.length > 0 && (
              <div className="mt-3 border-t border-[color:var(--color-line)] pt-2.5">
                <div className="panel-label mb-1.5">Pre-warming</div>
                <div className="flex flex-wrap gap-1.5">
                  {state.warming.map((id) => (
                    <Chip
                      key={id}
                      tone={
                        ACCESS_NETWORK_META[id].accent === 'violet'
                          ? 'violet'
                          : ACCESS_NETWORK_META[id].accent === 'blue'
                            ? 'blue'
                            : 'cyan'
                      }
                    >
                      {ACCESS_NETWORK_META[id].label}
                    </Chip>
                  ))}
                </div>
              </div>
            )}
          </Panel>

          <Panel title="Decision log">
            {state.latestDecision ? (
              <>
                <p className="text-[12.5px] leading-snug">{state.latestDecision.reason}</p>
                <div className="mt-2 flex items-center gap-2 text-[10.5px] text-[color:var(--color-muted)]">
                  <span className="metric font-[family-name:var(--font-mono)]">
                    t+{state.latestDecision.at.toFixed(1)}s
                  </span>
                  {state.latestDecision.confidence !== undefined && (
                    <span>confidence {(state.latestDecision.confidence * 100).toFixed(0)}% · illustrative</span>
                  )}
                </div>
              </>
            ) : (
              <p className="text-[12px] text-[color:var(--color-muted)]">No decisions yet in this run.</p>
            )}
          </Panel>

          <Panel title="Scene lab">
            <p className="text-[12px] leading-snug text-[color:var(--color-muted)]">
              Inspect the rover, scrub the mission timeline, switch cameras and toggle the coverage
              overlay.
            </p>
            <a className="control mt-2.5 w-full" href="/scene-lab">
              Open scene lab →
            </a>
          </Panel>
        </div>
      </div>

      {/* ---------------- footer strip ---------------- */}
      <div className="panel mt-3 grid grid-cols-2 gap-x-6 gap-y-3 px-5 py-4 md:grid-cols-4">
        {FEATURES.map((feature) => (
          <div key={feature.title} className="flex items-start gap-3">
            <span
              aria-hidden
              className="mt-1 block h-[9px] w-[9px] shrink-0 rounded-[3px]"
              style={{ background: 'linear-gradient(135deg,#176BFF,#7C3CFF)' }}
            />
            <div>
              <div className="text-[12.5px] font-semibold">{feature.title}</div>
              <div className="text-[11.5px] text-[color:var(--color-muted)]">{feature.body}</div>
            </div>
          </div>
        ))}
      </div>

      <p className="py-3 text-center text-[11px] text-[color:var(--color-muted)]">
        Phase 1 — vehicle, world and visual foundation. Figures are a deterministic geometric preview,
        not measured network performance.
      </p>
    </main>
  );
}
