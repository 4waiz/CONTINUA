'use client';

/**
 * The Mission dashboard - the flagship view.
 *
 * Layout is a fixed three-column grid inside one viewport: measurements on the
 * left, the world in the middle, application health on the right. It does not
 * scroll. The side columns own their scrollbars if a small screen forces it, so
 * the shell itself never gets one and the hero is never pushed out of view.
 *
 * Two rules the redesign had to keep:
 *
 * 1. **Every control does something.** There are no decorative buttons, no
 *    placeholder tables and no hard-coded counters.
 * 2. **A value that does not exist is not a zero.** With no run, or with the
 *    engine down, the metric cards show a placeholder rule and say what they are
 *    waiting for. The 3D scene still renders - from the Phase 1 preview source,
 *    badged `SCENE PREVIEW` - because an empty grey rectangle is a worse answer
 *    than an honest one.
 */

import { api, EngineApiError, type PolicySpec, type ScenarioSpec } from '@/lib/api';
import { useEngineRun } from '@/lib/useEngineRun';
import { EngineStatus } from '@/components/ui/EngineStatus';
import { IS_PUBLIC_PREVIEW } from '@/lib/deployment';
import { demoIndex, findDemoRun, type DemoRunSummary } from '@/lib/staticDemo';
import { MetricCard } from '@/components/ui/MetricCard';
import type { EngineLinkId, PolicyIdString } from '@continua/contracts/engine';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppShell, RunStatusBar } from '../AppShell';
import { Chip } from '../ui/primitives';
import { FullscreenButton } from './FullscreenButton';
import { MissionScene } from './MissionScene';
import { NetworkRail } from './NetworkRail';
import { PipelineRail } from './PipelineRail';
import { HealthPanel } from './HealthPanel';
import { LiveTelemetry } from './LiveTelemetry';
import { CameraPanel } from './panels';

const SPEEDS = [0.5, 1, 2, 4, 8] as const;
/** How many recent events feed a metric card's sparkline. */
const TREND_WINDOW = 60;

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function MissionView() {
  const [scenarios, setScenarios] = useState<ScenarioSpec[]>([]);
  const [policies, setPolicies] = useState<PolicySpec[]>([]);
  const [scenarioId, setScenarioId] = useState('wifi-degradation');
  const [policyId, setPolicyId] = useState<PolicyIdString>('P1');
  const [seed, setSeed] = useState(1);
  const [predictor] = useState<'heuristic' | 'learned' | 'none'>('heuristic');
  const [startedRunId, setStartedRunId] = useState<string | null>(null);
  const [selectedLink, setSelectedLink] = useState<EngineLinkId>('wifi');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [bootAttempt, setBootAttempt] = useState(0);
  const [demoRuns, setDemoRuns] = useState<DemoRunSummary[]>([]);

  /**
   * Which run is on screen. Locally that is whichever one the operator started.
   * On the public build every scenario-and-policy pair was recorded ahead of
   * time, so the selection *is* the run: derived here rather than pushed
   * through an effect, which would render one frame of the previous run first.
   */
  const runId = IS_PUBLIC_PREVIEW
    ? (findDemoRun(demoRuns, scenarioId, policyId)?.run_id ?? null)
    : startedRunId;

  const run = useEngineRun(runId);
  const playing = run.state?.status === 'running';
  // The element that goes fullscreen: the scene and its overlay chrome.
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.scenarios(), api.policies()])
      .then(([s, p]) => {
        if (cancelled) return;
        setScenarios(s.scenarios);
        setPolicies(p.policies);
        setBootError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setBootError(
          cause instanceof EngineApiError ? cause.message : 'Could not load scenarios from the engine.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [bootAttempt]);

  // The catalogue of recordings, so a scenario-and-policy selection can be
  // resolved to the run the engine produced for it.
  useEffect(() => {
    if (!IS_PUBLIC_PREVIEW) return;
    let cancelled = false;
    demoIndex()
      .then((index) => {
        if (cancelled) return;
        setDemoRuns(index.runs);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setBootError(cause instanceof Error ? cause.message : 'Could not load the recorded runs.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Follow the carrying link unless the operator has pinned one. Derived during
  // render rather than synchronised from an effect: the effect version renders
  // one frame with the stale link and then re-renders.
  const carrying = run.latest?.carrying ?? null;
  const [pinned, setPinned] = useState(false);
  const activeLink: EngineLinkId = pinned ? selectedLink : (carrying ?? selectedLink);

  // A confirmation is worth one glance, not the rest of the session: it sits
  // over the pipeline rail, so it has to leave on its own.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const act = useCallback(async (fn: () => Promise<unknown>, message?: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await fn();
      if (message) setNotice(message);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, []);

  const start = useCallback(
    () =>
      act(async () => {
        const response = await api.startRun({
          control: { scenario_id: scenarioId, policy_id: policyId, seed, speed: 1, predictor, horizon_s: 3 },
        });
        setStartedRunId(response.run_id);
        setPinned(false);
      }, 'Run started.'),
    [act, scenarioId, policyId, seed, predictor],
  );

  const control = useCallback(
    (action: 'play' | 'pause' | 'reset' | 'stop', extra?: Record<string, number>) =>
      act(async () => {
        if (!runId) return;
        await api.controlRun(runId, { action, ...extra });
      }),
    [act, runId],
  );

  const replay = useCallback(
    () =>
      act(async () => {
        if (!runId) throw new Error('Start a run first, then replay it.');
        const response = await api.replay(runId);
        setStartedRunId(response.run_id);
      }, 'Replaying the recorded run.'),
    [act, runId],
  );

  const seek = useCallback(
    (t: number) =>
      act(async () => {
        if (!runId) return;
        await api.controlRun(runId, { action: 'seek', t });
      }),
    [act, runId],
  );

  const scenario = useMemo(
    () => scenarios.find((s) => s.id === (run.state?.scenario_id ?? scenarioId)),
    [scenarios, run.state?.scenario_id, scenarioId],
  );

  const duration = run.state?.duration_s ?? scenario?.duration_s ?? 100;
  const t = run.state?.t ?? 0;
  const observation = run.latest?.links[activeLink];
  const app = run.latest?.app;

  // --- metric-card trends --------------------------------------------------
  // Sampled from the received history only. A reconnect gap is a gap; it is
  // never interpolated across.
  const recent = useMemo(() => run.history.slice(-TREND_WINDOW), [run.history]);
  const trend = useCallback(
    (pick: (event: (typeof recent)[number]) => number | null) =>
      recent.map(pick).filter((value): value is number => value !== null && Number.isFinite(value)),
    [recent],
  );

  // Wi-Fi is the only link that reports a signal strength, so the signal card is
  // always about Wi-Fi regardless of which link is currently carrying.
  const wifi = run.latest?.links.wifi;
  const wifiPhase = wifi?.phase ?? null;
  const wifiStatus =
    wifiPhase === 'unavailable'
      ? 'Out of range'
      : wifiPhase === 'carrying'
        ? 'Carrying'
        : (wifi?.rssi_dbm ?? 0) < -74
          ? 'Fading'
          : 'Available';
  const rssiTrend = useMemo(() => trend((e) => e.links.wifi?.rssi_dbm ?? null), [trend]);
  const rttTrend = useMemo(() => trend((e) => e.links[activeLink]?.rtt_ms ?? null), [trend, activeLink]);
  const lossTrend = useMemo(() => trend((e) => e.links[activeLink]?.loss_pct ?? null), [trend, activeLink]);

  const rttDelta = rttTrend.length > 6 ? rttTrend[rttTrend.length - 1] - rttTrend[rttTrend.length - 7] : null;

  const transport = IS_PUBLIC_PREVIEW ? (
    // Every scenario and policy here resolves to a recording, so the transport
    // is the same instrument as the local build minus the one verb that needs a
    // live engine: composing a run nobody recorded.
    <>
      <button
        type="button"
        className="control control-primary"
        onClick={() => control(playing ? 'pause' : 'play')}
        disabled={busy || !runId}
        data-active={playing}
      >
        {playing ? '❙❙ Pause' : '▶ Play'}
      </button>
      <button type="button" className="control" onClick={() => control('reset')} disabled={busy || !runId}>
        ↺ Restart
      </button>
      <a className="control no-underline" href="/experiments">
        ⇄ Compare policies
      </a>
    </>
  ) : (
    <>
      <button type="button" className="control control-primary" onClick={start} disabled={busy}>
        ▶ Start run
      </button>
      <button
        type="button"
        className="control"
        onClick={() => control(playing ? 'pause' : 'play')}
        disabled={busy || !runId}
        data-active={playing}
      >
        {playing ? '❙❙ Pause' : '▶ Resume'}
      </button>
      <button type="button" className="control" onClick={() => control('reset')} disabled={busy || !runId}>
        ↺ Reset
      </button>
      <button type="button" className="control" onClick={replay} disabled={busy || !runId}>
        ⟲ Replay
      </button>
      <a className="control no-underline" href="/experiments">
        ⇄ Compare
      </a>
    </>
  );

  return (
    <AppShell
      bar={
        <RunStatusBar
          state={run.state}
          connection={run.connection}
          stale={run.stale}
          dropped={run.droppedSequences}
          actions={transport}
        />
      }
    >
      <div className="relative flex h-full min-h-0 flex-col gap-3">
        {bootError && !IS_PUBLIC_PREVIEW && (
          <EngineStatus
            detail={bootError}
            retrying={busy}
            onRetry={() => setBootAttempt((n) => n + 1)}
          />
        )}

        <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)] gap-3 xl:grid-cols-[264px_minmax(0,1fr)_312px]">
          {/* ---------------- left: headline measurements ---------------- */}
          <div className="scroll-y flex flex-col gap-3 pr-0.5">
            <MetricCard
              label="Wi-Fi signal"
              value={wifi?.rssi_dbm ?? null}
              unit="dBm"
              format={(v) => v.toFixed(0)}
              tone={(wifi?.rssi_dbm ?? 0) < -82 ? 'bad' : (wifi?.rssi_dbm ?? 0) < -74 ? 'warn' : 'good'}
              status={wifiStatus}
              statusTone={wifiPhase === 'unavailable' ? 'bad' : wifiPhase === 'carrying' ? 'good' : 'neutral'}
              context={undefined}
              history={rssiTrend}
              unavailableReason="Waiting for engine"
            />
            <MetricCard
              label="Round trip time"
              value={observation?.rtt_ms ?? null}
              unit="ms"
              format={(v) => v.toFixed(0)}
              tone={(observation?.rtt_ms ?? 0) > 150 ? 'warn' : 'neutral'}
              context={
                // Only worth a line when it actually moved.
                rttDelta !== null && Math.abs(rttDelta) >= 1
                  ? `${rttDelta > 0 ? '↑' : '↓'} ${Math.abs(rttDelta).toFixed(0)} ms`
                  : undefined
              }
              history={rttTrend}
            />
            <MetricCard
              label="Packet loss"
              value={observation?.loss_pct ?? null}
              unit="%"
              format={(v) => v.toFixed(1)}
              tone={(observation?.loss_pct ?? 0) > 3 ? 'bad' : (observation?.loss_pct ?? 0) > 1 ? 'warn' : 'good'}
              context="receiver-side"
              history={lossTrend}
            />
            <MetricCard
              label="Session continuity"
              value={app ? app.outage_s : null}
              unit="s"
              format={(v) => v.toFixed(2)}
              tone={app?.in_outage ? 'bad' : 'good'}
              status={app ? (app.in_outage ? 'Interrupted' : 'Active') : undefined}
              statusTone={app?.in_outage ? 'bad' : 'good'}
              context={
                app
                  ? `${app.session_reconnects} reconnect${app.session_reconnects === 1 ? '' : 's'}${app.safe_stop ? ' · safe stop' : ''}`
                  : undefined
              }
            />
          </div>

          {/* ---------------- centre: the world ---------------- */}
          <div className="flex min-h-0 flex-col gap-3">
            <div ref={stageRef} className="relative min-h-0 flex-1 bg-[color:var(--color-bg)]">
              <MissionScene
                source={run.source}
                t={t}
                duration={duration}
                playing={playing && !run.stale}
                className="absolute inset-0 h-full w-full"
                preview={!runId}
              />

              {/* Overlay chrome. Pointer-events off so the canvas stays draggable. */}
              <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="panel-label">Mission view</p>
                    <p className="text-[13px] font-semibold leading-tight">
                      Emergency response / industrial inspection
                    </p>
                  </div>
                  <div className="pointer-events-auto flex items-center gap-2">
                    {runId ? (
                      <Chip tone="blue">PREDICTIVE HANDOFF</Chip>
                    ) : (
                      <Chip tone="muted">SCENE PREVIEW</Chip>
                    )}
                    <FullscreenButton target={stageRef} />
                  </div>
                </div>

                <div className="flex items-end justify-between gap-4">
                  <div className="rounded-[12px] border border-[color:var(--color-line)] bg-white/88 px-3 py-2 backdrop-blur">
                    <span className="metric font-[family-name:var(--font-mono)] text-[13px] font-semibold">
                      {formatClock(t)} / {formatClock(duration)}
                    </span>
                  </div>
                  {pinned && (
                    <button
                      type="button"
                      className="control pointer-events-auto"
                      onClick={() => setPinned(false)}
                      title="Return to automatically following whichever link is carrying the session"
                    >
                      Pinned to {activeLink} · auto-follow
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Timeline + run setup, one compact row. */}
            <div className="panel flex flex-wrap items-center gap-3 px-4 py-2.5">
              <select
                className="control min-w-[190px]"
                value={scenarioId}
                onChange={(event) => {
                  setScenarioId(event.target.value);
                  setPinned(false);
                }}
                aria-label="Scenario"
                disabled={scenarios.length === 0}
              >
                {scenarios.length === 0 && <option>No scenarios - engine offline</option>}
                {scenarios.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.title}
                  </option>
                ))}
              </select>
              <select
                className="control"
                value={policyId}
                onChange={(event) => {
                  setPolicyId(event.target.value as PolicyIdString);
                  setPinned(false);
                }}
                aria-label="Policy"
                disabled={policies.length === 0}
              >
                {policies.length === 0 && <option> - </option>}
                {policies.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.id}
                    {entry.id === 'P1' ? ' - CONTINUA' : ''}
                  </option>
                ))}
              </select>
              {/* A recording's seed is a fact of the recording, shown in the
                  run bar. There is nothing to type in. */}
              <label
                className="flex items-center gap-2 text-[12px] text-[color:var(--color-muted)]"
                hidden={IS_PUBLIC_PREVIEW}
              >
                Seed
                <input
                  className="control w-[84px]"
                  type="number"
                  min={0}
                  max={2147483647}
                  value={seed}
                  onChange={(event) => setSeed(Number(event.target.value) || 0)}
                />
              </label>
              <select
                className="control"
                value={run.state?.speed ?? 1}
                onChange={(event) => control('play', { speed: Number(event.target.value) })}
                disabled={!runId}
                aria-label="Playback speed"
              >
                {SPEEDS.map((speed) => (
                  <option key={speed} value={speed}>
                    {speed}×
                  </option>
                ))}
              </select>
              <input
                type="range"
                className="scrub min-w-[140px] flex-1"
                min={0}
                max={duration}
                step={0.1}
                value={t}
                style={{ ['--progress' as string]: String(duration ? t / duration : 0) }}
                onChange={(event) => seek(Number(event.target.value))}
                disabled={!runId}
                aria-label="Run timeline"
              />
            </div>

            <NetworkRail
              event={run.latest}
              selected={activeLink}
              onSelect={(link) => {
                setSelectedLink(link);
                setPinned(true);
              }}
            />

            <PipelineRail event={run.latest} />
          </div>

          {/* ---------------- right: application health ---------------- */}
          <div className="scroll-y flex flex-col gap-3 pr-0.5">
            <HealthPanel event={run.latest} />
            <LiveTelemetry history={run.history} link={activeLink} />
            <CameraPanel event={run.latest} />
          </div>
        </div>

        {(notice || (run.connection === 'disconnected' && runId)) && (
          <div
            className="pointer-events-none absolute bottom-5 left-1/2 z-20 -translate-x-1/2"
            role="status"
          >
            <p className="card px-4 py-2 text-[12.5px] shadow-[var(--shadow-raised)]">
              {run.connection === 'disconnected' && runId ? (
                <>
                  <strong className="text-[color:var(--color-bad)]">Backend disconnected.</strong>{' '}
                  Values shown are the last received, not current. Reconnecting (attempt{' '}
                  {run.reconnectAttempts})…
                </>
              ) : (
                notice
              )}
            </p>
          </div>
        )}
      </div>
    </AppShell>
  );
}
