'use client';

/**
 * The Mission dashboard.
 *
 * Every control here does something. There are no decorative buttons, no
 * placeholder tables and no hard-coded counters — if the engine has not
 * produced a value, the panel says so.
 */

import { api, EngineApiError, type PolicySpec, type ScenarioSpec } from '@/lib/api';
import { useEngineRun } from '@/lib/useEngineRun';
import type { EngineLinkId, PolicyIdString } from '@continua/contracts/engine';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell, RunIdentity } from '../AppShell';
import { Chip, Panel } from '../ui/primitives';
import { MissionScene } from './MissionScene';
import {
  AccessStrip,
  ApplicationHealthPanel,
  CameraPanel,
  ContinuityPanel,
  PipelineTimeline,
  SelectedLinkCards,
  TelemetryPanel,
} from './panels';

const SPEEDS = [0.5, 1, 2, 4, 8] as const;

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
  const [predictor, setPredictor] = useState<'heuristic' | 'learned' | 'none'>('heuristic');
  const [runId, setRunId] = useState<string | null>(null);
  const [selectedLink, setSelectedLink] = useState<EngineLinkId>('wifi');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  const run = useEngineRun(runId);
  const playing = run.state?.status === 'running';

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
          cause instanceof EngineApiError
            ? cause.message
            : 'Could not load scenarios from the engine.',
        );
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

  const act = useCallback(
    async (fn: () => Promise<unknown>, message?: string) => {
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
    },
    [],
  );

  const start = useCallback(
    () =>
      act(async () => {
        const response = await api.startRun({
          control: { scenario_id: scenarioId, policy_id: policyId, seed, speed: 1, predictor, horizon_s: 3 },
        });
        setRunId(response.run_id);
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
        setRunId(response.run_id);
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

  const windowS = run.latest?.links[activeLink]?.window_s ?? 2;
  const duration = run.state?.duration_s ?? scenario?.duration_s ?? 100;
  const t = run.state?.t ?? 0;

  const actions = (
    <>
      <button type="button" className="control" onClick={start} disabled={busy}>
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
      <a className="control" href="/experiments">
        ⇄ Comparison
      </a>
    </>
  );

  return (
    <AppShell
      identity={
        <RunIdentity
          state={run.state}
          connection={run.connection}
          stale={run.stale}
          dropped={run.droppedSequences}
        />
      }
      actions={actions}
    >
      {bootError && (
        <div className="panel border-[color:var(--color-bad)] px-3.5 py-2.5 text-[12px]">
          <strong className="text-[color:var(--color-bad)]">Engine unreachable.</strong> {bootError}
          <div className="mt-1 font-[family-name:var(--font-mono)] text-[11px] text-[color:var(--color-muted)]">
            Start it with: <code>npm run engine</code>
          </div>
        </div>
      )}
      {notice && (
        <div className="panel px-3.5 py-2 text-[11.5px] text-[color:var(--color-muted)]">{notice}</div>
      )}

      {/* ---------------- run setup ---------------- */}
      <Panel dense>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="panel-label">Scenario</span>
            <select
              className="control min-w-[220px]"
              value={scenarioId}
              onChange={(event) => setScenarioId(event.target.value)}
            >
              {scenarios.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.title}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="panel-label">Policy</span>
            <select
              className="control"
              value={policyId}
              onChange={(event) => setPolicyId(event.target.value as PolicyIdString)}
            >
              {policies.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.id}
                  {entry.id === 'P1' ? ' — CONTINUA' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="panel-label">Predictor</span>
            <select
              className="control"
              value={predictor}
              onChange={(event) => setPredictor(event.target.value as typeof predictor)}
            >
              <option value="heuristic">heuristic</option>
              <option value="learned">learned (falls back)</option>
              <option value="none">none</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="panel-label">Seed</span>
            <input
              className="control w-[92px]"
              type="number"
              min={0}
              max={2147483647}
              value={seed}
              onChange={(event) => setSeed(Number(event.target.value) || 0)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="panel-label">Speed</span>
            <select
              className="control"
              value={run.state?.speed ?? 1}
              onChange={(event) => control('play', { speed: Number(event.target.value) })}
              disabled={!runId}
            >
              {SPEEDS.map((speed) => (
                <option key={speed} value={speed}>
                  {speed}×
                </option>
              ))}
            </select>
          </label>
          {scenario && (
            <p className="min-w-[220px] flex-1 text-[11px] leading-snug text-[color:var(--color-muted)]">
              {scenario.description}
            </p>
          )}
        </div>

        <div className="mt-2.5 flex items-center gap-3">
          <span className="metric font-[family-name:var(--font-mono)] text-[11px] text-[color:var(--color-muted)]">
            {formatClock(t)} / {formatClock(duration)}
          </span>
          <input
            type="range"
            className="scrub flex-1"
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
      </Panel>

      {/* ---------------- main grid ---------------- */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[288px_minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-3">
          <SelectedLinkCards
            link={activeLink}
            observation={run.latest?.links[activeLink]}
            history={run.history}
            windowS={windowS}
          />
          <ContinuityPanel event={run.latest} />
        </div>

        <div className="flex min-h-[420px] flex-col gap-3">
          {runId ? (
            <MissionScene
              source={run.source}
              t={t}
              duration={duration}
              playing={playing && !run.stale}
              className="min-h-[42vh] flex-1"
            />
          ) : (
            <div className="scene-shell grid min-h-[42vh] flex-1 place-items-center">
              <div className="max-w-sm p-6 text-center">
                <div className="panel-label mb-2">No run</div>
                <p className="text-[13px] text-[color:var(--color-muted)]">
                  Pick a scenario and policy, then <strong>Start run</strong>. The scene is driven by
                  the engine’s vehicle and network state — it is not a recording.
                </p>
              </div>
            </div>
          )}
          <AccessStrip
            event={run.latest}
            selected={activeLink}
            onSelect={(link) => {
              setSelectedLink(link);
              setPinned(true);
            }}
          />
          {pinned && (
            <button
              type="button"
              className="control self-start"
              onClick={() => setPinned(false)}
              title="Return to automatically following whichever link is carrying the session"
            >
              Following {activeLink} · click to auto-follow
            </button>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <ApplicationHealthPanel event={run.latest} />
          <TelemetryPanel history={run.history} link={activeLink} />
          <CameraPanel event={run.latest} />
        </div>
      </div>

      <PipelineTimeline decisions={run.decisions} latest={run.latest} />

      {run.connection === 'disconnected' && runId && (
        <div className="panel border-[color:var(--color-bad)] px-3.5 py-2.5 text-[12px]">
          <strong className="text-[color:var(--color-bad)]">Backend disconnected.</strong> The values
          above are the last received, not current. Reconnecting (attempt {run.reconnectAttempts})…
        </div>
      )}
      {run.droppedSequences > 0 && (
        <div className="panel px-3.5 py-2 text-[11.5px]">
          <Chip tone="warn">{run.droppedSequences} events missed</Chip>{' '}
          <span className="text-[color:var(--color-muted)]">
            A reconnect skipped part of the stream. Charts show the received history only; the
            complete log is on the backend and in the run’s JSONL file.
          </span>
        </div>
      )}
    </AppShell>
  );
}
