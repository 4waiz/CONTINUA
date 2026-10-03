'use client';

/**
 * `/scene-lab` - the controls, readouts and layout around the scene.
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
import { AppShell } from './AppShell';
import { ScenePerformance } from './ScenePerformance';
import { SceneStage } from './SceneStage';
import { ButtonGroup, Chip, GlassSection, PreviewBadge, Stat, Toggle } from './ui/primitives';
import { NetworkIcon, PauseIcon, PlayIcon, ResetIcon } from './ui/icons';

// ---------------------------------------------------------------------------

const CAMERA_OPTIONS: readonly { value: CameraMode; label: string; title: string }[] = [
  { value: 'follow', label: 'Follow', title: 'Chase camera, locked to the smoothed road tangent' },
  { value: 'overview', label: 'Overview', title: 'High wide shot showing route and infrastructure' },
  { value: 'closeup', label: 'Close-up', title: 'Low orbit near the rover' },
  { value: 'cinematic', label: 'Cinematic', title: 'A director cutting between angles on the rover - tracking, orbit, low lead, crane' },
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
    <section className="glass flex items-center gap-3 px-3 py-2.5" aria-label="Playback">
      <button
        type="button"
        className="control w-[100px] shrink-0"
        data-active={playback.playing}
        onClick={() => clock.toggle()}
        aria-label={playback.playing ? 'Pause' : 'Play'}
      >
        {playback.playing ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
        {playback.playing ? 'Pause' : 'Play'}
      </button>
      <button type="button" className="control shrink-0" onClick={() => clock.reset()}>
        <ResetIcon size={15} /> Reset
      </button>
      <select
        className="control w-[70px] shrink-0 px-2.5"
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
      <span className="metric w-[104px] shrink-0 text-center font-[family-name:var(--font-mono)] text-[12.5px] font-semibold">
        {formatClock(playback.simTime)}
        <span className="text-[color:var(--color-faint)]"> / {formatClock(clock.duration)}</span>
      </span>

      <div className="relative min-w-[200px] flex-1">
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

      <span className="hidden shrink-0 text-[12px] text-[color:var(--color-muted)] xl:inline">
        <strong className="font-semibold text-[color:var(--color-ink)]">
          {MISSION_ZONES.find((zone) => zone.id === state.zone)?.label ?? state.zone}
        </strong>
        <span className="metric ml-2">{state.vehicle.distance.toFixed(0)} m</span>
      </span>
    </section>
  );
}

function LinkPanel() {
  const state = useThrottledSceneState(200);

  return (
    <GlassSection title="Access networks" action={<PreviewBadge source={state.source} />}>
      <p className="mb-2.5 text-[11.5px] leading-snug text-[color:var(--color-muted)]">
        Four alternative links to one gateway - not a chain. At most one carries the session.
      </p>
      <ul className="space-y-1">
        {ACCESS_NETWORKS.map((id: AccessNetworkId) => {
          const link = state.links[id];
          const meta = ACCESS_NETWORK_META[id];
          const isActive = link.state === 'active' || link.state === 'degraded';
          return (
            <li
              key={id}
              className="flex items-center gap-2.5 rounded-[12px] px-2.5 py-2 transition-colors"
              style={{
                background: isActive ? `color-mix(in srgb, ${NETWORK_COLOR[id]} 9%, white)` : 'transparent',
                opacity: link.state === 'unavailable' ? 0.5 : 1,
              }}
            >
              <span
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${link.state === 'warming' ? 'breathe' : ''}`}
                style={{
                  background: isActive ? NETWORK_COLOR[id] : `color-mix(in srgb, ${NETWORK_COLOR[id]} 12%, white)`,
                  color: isActive ? 'white' : NETWORK_COLOR[id],
                }}
              >
                <NetworkIcon link={id} size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[13px] font-semibold">{meta.label}</span>
                  <span className="truncate text-[11px] text-[color:var(--color-muted)]">
                    {meta.sublabel}
                  </span>
                </div>
                <div className="text-[11px] text-[color:var(--color-muted)]">
                  {LINK_STATE_LABEL[link.state]}
                  {id === 'wired' && link.tethered ? ' · tethered' : ''}
                </div>
              </div>
              <div
                className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full"
                style={{ background: 'var(--color-line)' }}
                title={`Modelled coverage ${(link.coverage * 100).toFixed(0)}% - geometric, not a measured signal level`}
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
    </GlassSection>
  );
}

function RunPanel() {
  const state = useThrottledSceneState(250);
  const activeMeta = state.active ? ACCESS_NETWORK_META[state.active] : null;

  return (
    <GlassSection title="Mission run">
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
          value={activeMeta?.label ?? ' - '}
          tone={state.active ? NETWORK_COLOR[state.active] : undefined}
        />
        <Stat label="Session" value={state.traffic.handoffCount >= 0 ? 'Continuous' : ' - '} tone="var(--color-good)" />
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
        <div className="mt-3 rounded-[12px] bg-[color:var(--color-surface-muted)] p-2.5">
          <div className="section-label mb-1">Latest decision</div>
          <p className="text-[12px] leading-snug">{state.latestDecision.reason}</p>
          {/* The preview source used to print "Model confidence 99% - illustrative"
              here. There is no model in the Phase 1 preview and nothing produced
              a 99, so the number was decoration wearing the clothes of a
              measurement - precisely what hard rule 1 forbids. What the panel can
              honestly say is where the handoff plan comes from. */}
          <p className="mt-1 text-[11px] text-[color:var(--color-muted)]">
            Planned from route geometry and coverage radii - not a measurement.
          </p>
        </div>
      )}
    </GlassSection>
  );
}

function ViewPanel() {
  const settings = useSceneSettings();
  const setSettings = useSetSceneSettings();
  const selected = SITES.find((site) => site.id === settings.selectedSiteId) ?? null;

  return (
    <GlassSection title="View">
      <p className="mb-3 text-[11.5px] leading-snug text-[color:var(--color-muted)]">
        Visualisation and inspection - a deterministic geometric preview, not measured network performance.
      </p>
      <div className="space-y-2.5">
        <div>
          <div className="section-label mb-1.5">Mode</div>
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
          <div className="section-label mb-1.5">Camera</div>
          <ButtonGroup<CameraMode>
            label="Camera"
            value={settings.camera}
            onChange={(camera) => setSettings({ camera })}
            options={CAMERA_OPTIONS}
          />
          {settings.mode === 'inspect' && (
            <p className="mt-1 text-[11px] text-[color:var(--color-muted)]">
              Inspect mode uses the turntable camera.
            </p>
          )}
        </div>

        <div>
          <div className="section-label mb-1.5">Quality</div>
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
          <div className="rounded-[12px] bg-[color:var(--color-surface-muted)] p-2.5">
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

        <p className="text-[11px] leading-snug text-[color:var(--color-muted)]">
          Space play/pause · ← → scrub · Shift+← → 10 s · C coverage · R reset
        </p>
      </div>
    </GlassSection>
  );
}

// ---------------------------------------------------------------------------

export function SceneLab() {
  useSceneKeyboard();

  return (
    // Scene Lab used to carry its own header and a "← Dashboard" link, which made
    // it feel like a separate tool. It is a page of the same product, so it gets
    // the same shell and the same navigation.
    <AppShell variant="immersive" bar={<ScenePerformance />}>
      <div className="absolute inset-0 overflow-hidden" style={{ ['--dock-h' as string]: '58px' }}>
        <SceneStage className="scene-shell-bleed absolute inset-0 h-full w-full" />

        <aside className="mission-side mission-left scroll-y">
          <div className="glass">
            <ViewPanel />
          </div>
        </aside>

        <aside className="mission-side mission-right scroll-y">
          <div className="glass divide-y divide-[color:var(--color-line)]">
            <LinkPanel />
            <RunPanel />
          </div>
        </aside>

        <div className="mission-dock">
          <Transport />
        </div>
      </div>
    </AppShell>
  );
}
