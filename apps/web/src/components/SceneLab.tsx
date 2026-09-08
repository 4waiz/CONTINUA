'use client';

/**
 * `/scene-lab` — the controls, readouts and layout around the scene.
 *
 * The readouts are throttled reads of the same scene state the renderer uses,
 * never a parallel simulation, and everything is labelled with its provenance:
 * in Phase 1 the source is `preview`, so nothing here claims to be a
 * measurement.
 */

import {
  ACCESS_NETWORK_META,
  ACCESS_NETWORKS,
  type AccessNetworkId,
  type CameraMode,
  type LinkState,
  type QualityTier,
  type SceneMode,
} from '@continua/contracts';
import {
  MISSION_ZONES,
  NETWORK_COLOR,
  PreviewSceneStateSource,
  SITES,
  useSceneKeyboard,
  usePlayback,
  useSceneRuntime,
  useSceneSettings,
  useSetSceneSettings,
  useThrottledSceneState,
} from '@continua/scene';
import { useMemo } from 'react';
import { SceneStage } from './SceneStage';
import { ButtonGroup, Chip, Dot, Panel, PreviewBadge, Stat, Toggle } from './ui/primitives';

// ---------------------------------------------------------------------------

const CAMERA_OPTIONS: readonly { value: CameraMode; label: string; title: string }[] = [
  { value: 'follow', label: 'Follow', title: 'Chase camera, locked to the smoothed road tangent' },
  { value: 'overview', label: 'Overview', title: 'High wide shot showing route and infrastructure' },
  { value: 'closeup', label: 'Close-up', title: 'Low orbit near the rover' },
];

const SPEED_OPTIONS = [0.25, 0.5, 1, 2, 4] as const;

const LINK_STATE_LABEL: Record<LinkState, string> = {
  unavailable: 'No coverage',
  available: 'Available',
  warming: 'Pre-warming',
  active: 'Carrying session',
  degraded: 'Degraded',
};

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------

function Transport() {
  const { clock, source } = useSceneRuntime();
  const playback = usePlayback();
  const state = useThrottledSceneState(120);

  const markers = useMemo(() => {
    if (!(source instanceof PreviewSceneStateSource)) return [];
    return source.plannedHandoffs;
  }, [source]);

  const progress = playback.simTime / clock.duration;

  return (
    <Panel
      title="Playback"
      action={
        <span className="metric font-[family-name:var(--font-mono)] text-[11.5px] text-[color:var(--color-muted)]">
          {formatClock(playback.simTime)} / {formatClock(clock.duration)}
        </span>
      }
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="control"
          data-active={playback.playing}
          onClick={() => clock.toggle()}
          aria-label={playback.playing ? 'Pause' : 'Play'}
        >
          {playback.playing ? '❙❙ Pause' : '▶ Play'}
        </button>
        <button type="button" className="control" onClick={() => clock.reset()}>
          ↺ Reset
        </button>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="panel-label">Speed</span>
          <select
            className="control px-2"
            value={playback.speed}
            onChange={(event) => clock.setSpeed(Number(event.target.value))}
            aria-label="Preview speed"
          >
            {SPEED_OPTIONS.map((speed) => (
              <option key={speed} value={speed}>
                {speed}×
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="relative mt-3">
        <input
          type="range"
          className="scrub"
          min={0}
          max={clock.duration}
          step={0.05}
          value={playback.simTime}
          style={{ ['--progress' as string]: String(progress) }}
          onChange={(event) => clock.setTime(Number(event.target.value))}
          aria-label="Mission timeline"
        />
        <div className="pointer-events-none absolute inset-x-0 top-[15px] h-0">
          {markers.map((marker, index) => (
            <span
              key={index}
              className="absolute -translate-x-1/2 rounded-full"
              title={`Handoff → ${marker.to}`}
              style={{
                left: `${(marker.at / clock.duration) * 100}%`,
                width: 3,
                height: 10,
                marginTop: -2,
                background: NETWORK_COLOR[marker.to],
                opacity: 0.85,
              }}
            />
          ))}
        </div>
      </div>

      <div className="mt-1.5 flex items-center justify-between text-[11px] text-[color:var(--color-muted)]">
        <span>
          Zone ·{' '}
          <strong className="font-semibold text-[color:var(--color-ink)]">
            {MISSION_ZONES.find((zone) => zone.id === state.zone)?.label ?? state.zone}
          </strong>
        </span>
        <span className="metric">{state.vehicle.distance.toFixed(0)} m travelled</span>
      </div>
    </Panel>
  );
}

function LinkPanel() {
  const state = useThrottledSceneState(200);

  return (
    <Panel title="Access networks" action={<PreviewBadge source={state.source} />}>
      <p className="mb-3 text-[11.5px] leading-snug text-[color:var(--color-muted)]">
        Four alternative links to one gateway — not a chain. At most one carries the session.
      </p>
      <ul className="space-y-1.5">
        {ACCESS_NETWORKS.map((id: AccessNetworkId) => {
          const link = state.links[id];
          const meta = ACCESS_NETWORK_META[id];
          const isActive = link.state === 'active' || link.state === 'degraded';
          return (
            <li
              key={id}
              className="flex items-center gap-2.5 rounded-[10px] border px-2.5 py-2 transition-colors"
              style={{
                borderColor: isActive ? NETWORK_COLOR[id] : 'var(--color-line)',
                background: isActive
                  ? `color-mix(in srgb, ${NETWORK_COLOR[id]} 7%, white)`
                  : 'var(--color-surface)',
                opacity: link.state === 'unavailable' ? 0.5 : 1,
              }}
            >
              <Dot color={NETWORK_COLOR[id]} pulse={link.state === 'warming'} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[13px] font-semibold">{meta.label}</span>
                  <span className="truncate text-[10.5px] text-[color:var(--color-muted)]">
                    {meta.sublabel}
                  </span>
                </div>
                <div className="text-[10.5px] text-[color:var(--color-muted)]">
                  {LINK_STATE_LABEL[link.state]}
                  {id === 'wired' && link.tethered ? ' · tethered' : ''}
                </div>
              </div>
              <div
                className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full"
                style={{ background: 'var(--color-line)' }}
                title={`Modelled coverage ${(link.coverage * 100).toFixed(0)}% — geometric, not a measured signal level`}
              >
                <div
                  className="h-full rounded-full transition-[width] duration-200"
                  style={{ width: `${link.coverage * 100}%`, background: NETWORK_COLOR[id] }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function RunPanel() {
  const state = useThrottledSceneState(250);
  const activeMeta = state.active ? ACCESS_NETWORK_META[state.active] : null;

  return (
    <Panel title="Mission run">
      <div className="grid grid-cols-2 gap-3">
        <Stat
          label="Speed"
          value={(state.vehicle.speedMps * 3.6).toFixed(0)}
          unit="km/h"
          hint="Derived from the route speed profile"
        />
        <Stat
          label="Handoffs"
          value={String(state.traffic.handoffCount)}
          hint="Planned link changes passed so far in this run"
        />
        <Stat
          label="Active link"
          value={activeMeta?.label ?? '—'}
          tone={state.active ? NETWORK_COLOR[state.active] : undefined}
        />
        <Stat label="Session" value={state.traffic.handoffCount >= 0 ? 'Continuous' : '—'} tone="var(--color-good)" />
      </div>

      <dl className="mt-3 space-y-1 border-t border-[color:var(--color-line)] pt-2.5 text-[11.5px]">
        <div className="flex justify-between gap-2">
          <dt className="text-[color:var(--color-muted)]">Run ID</dt>
          <dd className="metric font-[family-name:var(--font-mono)]">{state.runId}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-[color:var(--color-muted)]">Session</dt>
          <dd className="metric font-[family-name:var(--font-mono)]">{state.traffic.sessionId}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-[color:var(--color-muted)]">Source</dt>
          <dd className="font-semibold uppercase tracking-wide">{state.source}</dd>
        </div>
      </dl>

      {state.latestDecision && (
        <div className="mt-3 rounded-[10px] border border-[color:var(--color-line)] bg-[color:var(--color-surface-muted)] p-2.5">
          <div className="panel-label mb-1">Latest decision</div>
          <p className="text-[12px] leading-snug">{state.latestDecision.reason}</p>
          {state.latestDecision.confidence !== undefined && (
            <p className="mt-1 text-[10.5px] text-[color:var(--color-muted)]">
              Model confidence {(state.latestDecision.confidence * 100).toFixed(0)}% · illustrative
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}

function ViewPanel() {
  const settings = useSceneSettings();
  const setSettings = useSetSceneSettings();
  const selected = SITES.find((site) => site.id === settings.selectedSiteId) ?? null;

  return (
    <Panel title="View">
      <div className="space-y-2.5">
        <div>
          <div className="panel-label mb-1.5">Mode</div>
          <ButtonGroup<SceneMode>
            label="Scene mode"
            value={settings.mode}
            onChange={(mode) => setSettings({ mode })}
            options={[
              { value: 'mission', label: 'Mission route', title: 'Drive the full route' },
              { value: 'inspect', label: 'Inspect rover', title: 'Parked turntable of the vehicle' },
            ]}
          />
        </div>

        <div>
          <div className="panel-label mb-1.5">Camera</div>
          <ButtonGroup<CameraMode>
            label="Camera"
            value={settings.camera}
            onChange={(camera) => setSettings({ camera })}
            options={CAMERA_OPTIONS}
          />
          {settings.mode === 'inspect' && (
            <p className="mt-1 text-[10.5px] text-[color:var(--color-muted)]">
              Inspect mode uses the turntable camera.
            </p>
          )}
        </div>

        <div>
          <div className="panel-label mb-1.5">Quality</div>
          <ButtonGroup<QualityTier>
            label="Quality"
            value={settings.quality}
            onChange={(quality) => setSettings({ quality })}
            options={[
              { value: 'high', label: 'High' },
              { value: 'balanced', label: 'Balanced' },
              { value: 'low', label: 'Low', title: 'LOD model, no shadows, reduced pixel ratio' },
            ]}
          />
        </div>

        <div className="space-y-1.5">
          <Toggle checked={settings.showCoverage} onChange={(showCoverage) => setSettings({ showCoverage })}>
            Coverage overlay
          </Toggle>
          <Toggle checked={settings.showMarkers} onChange={(showMarkers) => setSettings({ showMarkers })}>
            Infrastructure markers
          </Toggle>
        </div>

        {selected && (
          <div className="rounded-[10px] border border-[color:var(--color-line)] bg-[color:var(--color-surface-muted)] p-2.5">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[12.5px] font-semibold">{selected.label}</span>
              {selected.network && (
                <Chip
                  tone={
                    ACCESS_NETWORK_META[selected.network].accent === 'violet'
                      ? 'violet'
                      : ACCESS_NETWORK_META[selected.network].accent === 'blue'
                        ? 'blue'
                        : 'cyan'
                  }
                >
                  {ACCESS_NETWORK_META[selected.network].label}
                </Chip>
              )}
            </div>
            <p className="text-[11.5px] leading-snug text-[color:var(--color-muted)]">{selected.detail}</p>
            <button
              type="button"
              className="control mt-2 h-7 text-[11px]"
              onClick={() => setSettings({ selectedSiteId: null })}
            >
              Clear selection
            </button>
          </div>
        )}

        <p className="text-[10.5px] leading-snug text-[color:var(--color-muted)]">
          Space play/pause · ← → scrub · Shift+← → 10 s · C coverage · R reset
        </p>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------

export function SceneLab() {
  useSceneKeyboard();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1760px] flex-col gap-3 p-3 lg:p-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="block h-11 w-[3px] rounded-full"
            style={{ background: 'linear-gradient(180deg,#176BFF,#7C3CFF)' }}
          />
          <div>
            <h1 className="text-[26px] font-semibold leading-none tracking-[-0.02em]">
              <span style={{ color: 'var(--color-blue)' }}>CONTINUA</span>{' '}
              <span className="text-[color:var(--color-muted)]">Scene Lab</span>
            </h1>
            <p className="mt-1 text-[12.5px] text-[color:var(--color-muted)]">
              Predictive Network Continuity · by Team Kanban · The network changes. The session doesn’t.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a className="control" href="/">
            ← Dashboard
          </a>
        </div>
      </header>

      <div className="grid flex-1 grid-cols-1 gap-3 xl:grid-cols-[300px_minmax(0,1fr)_320px]">
        <div className="order-2 flex flex-col gap-3 xl:order-1">
          <ViewPanel />
        </div>

        <div className="order-1 flex min-h-[420px] flex-col gap-3 xl:order-2">
          <SceneStage className="min-h-[46vh] flex-1 xl:min-h-[62vh]" />
          <Transport />
        </div>

        <div className="order-3 flex flex-col gap-3">
          <LinkPanel />
          <RunPanel />
        </div>
      </div>

      <footer className="pb-1 text-center text-[11px] text-[color:var(--color-muted)]">
        Phase 1 — vehicle, world and visual foundation. Values shown are a deterministic geometric
        preview, not measured network performance.
      </footer>
    </main>
  );
}
