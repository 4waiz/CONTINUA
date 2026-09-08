'use client';

/**
 * Scenario Lab — build a run, then watch it.
 *
 * Every knob here maps to a validated field on `ScenarioOverrides` in the
 * engine. Overrides never mutate the catalogue: they produce a derived spec
 * that is hashed into the run manifest, so a lab run is exactly as reproducible
 * as a catalogue one.
 */

import { api, EngineApiError, type PolicySpec, type ScenarioSpec } from '@/lib/api';
import { useEngineRun } from '@/lib/useEngineRun';
import { LINK_IDS, LINK_LABEL, type EngineLinkId, type PolicyIdString, type TrafficClassId } from '@continua/contracts/engine';
import { TRAFFIC_CLASSES } from '@continua/contracts/engine';
import { useCallback, useEffect, useState } from 'react';
import { AppShell, RunIdentity } from './AppShell';
import { MissionScene } from './mission/MissionScene';
import { AccessStrip, ApplicationHealthPanel, PipelineTimeline } from './mission/panels';
import { Panel, Toggle } from './ui/primitives';

export function ScenarioLabView() {
  const [scenarios, setScenarios] = useState<ScenarioSpec[]>([]);
  const [policies, setPolicies] = useState<PolicySpec[]>([]);
  const [scenarioId, setScenarioId] = useState('baseline-journey');
  const [policyId, setPolicyId] = useState<PolicyIdString>('P1');
  const [seed, setSeed] = useState(7);
  const [runId, setRunId] = useState<string | null>(null);
  const [selectedLink, setSelectedLink] = useState<EngineLinkId>('wifi');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // --- overrides ------------------------------------------------------------
  const [speedScale, setSpeedScale] = useState(1);
  const [durationS, setDurationS] = useState<number | ''>('');
  const [workload, setWorkload] = useState<Record<TrafficClassId, boolean>>({
    control: true,
    telemetry: true,
    video: true,
    voice: true,
    bulk: true,
  });
  const [faultLink, setFaultLink] = useState<EngineLinkId | ''>('');
  const [faultAt, setFaultAt] = useState(30);
  const [faultFor, setFaultFor] = useState(12);
  const [congestLink, setCongestLink] = useState<EngineLinkId | ''>('');
  const [congestFactor, setCongestFactor] = useState(0.3);

  const run = useEngineRun(runId);
  const playing = run.state?.status === 'running';

  useEffect(() => {
    Promise.all([api.scenarios(), api.policies()])
      .then(([s, p]) => {
        setScenarios(s.scenarios);
        setPolicies(p.policies);
      })
      .catch((cause: unknown) =>
        setError(cause instanceof EngineApiError ? cause.message : 'Engine unreachable.'),
      );
  }, []);

  const launch = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const overrides: Record<string, unknown> = { workload };
      if (speedScale !== 1) overrides.speed_scale = speedScale;
      if (durationS !== '') overrides.duration_s = Number(durationS);
      if (faultLink) {
        overrides.inject_fault = faultLink;
        overrides.inject_fault_at_s = faultAt;
        overrides.inject_fault_duration_s = faultFor;
      }
      if (congestLink) {
        overrides.congest_link = congestLink;
        overrides.congest_factor = congestFactor;
      }
      const response = await api.startRun({
        control: { scenario_id: scenarioId, policy_id: policyId, seed, speed: 2, predictor: 'heuristic', horizon_s: 3 },
        overrides,
      });
      setRunId(response.run_id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [scenarioId, policyId, seed, workload, speedScale, durationS, faultLink, faultAt, faultFor, congestLink, congestFactor]);

  return (
    <AppShell
      identity={
        <RunIdentity state={run.state} connection={run.connection} stale={run.stale} dropped={run.droppedSequences} />
      }
      actions={
        <>
          <button type="button" className="control" onClick={launch} disabled={busy}>
            ▶ Launch configured run
          </button>
          {runId && (
            <button
              type="button"
              className="control"
              data-active={playing}
              onClick={() => api.controlRun(runId, { action: playing ? 'pause' : 'play' }).catch(() => undefined)}
            >
              {playing ? '❙❙ Pause' : '▶ Resume'}
            </button>
          )}
        </>
      }
    >
      {error && (
        <div className="panel border-[color:var(--color-bad)] px-3.5 py-2.5 text-[12px] text-[color:var(--color-bad)]">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          <Panel title="Base scenario">
            <label className="flex flex-col gap-1">
              <span className="panel-label">Scenario</span>
              <select className="control" value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}>
                {scenarios.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            </label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className="panel-label">Policy</span>
                <select
                  className="control"
                  value={policyId}
                  onChange={(e) => setPolicyId(e.target.value as PolicyIdString)}
                >
                  {policies.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="panel-label">Seed</span>
                <input
                  className="control"
                  type="number"
                  min={0}
                  value={seed}
                  onChange={(e) => setSeed(Number(e.target.value) || 0)}
                />
              </label>
            </div>
          </Panel>

          <Panel title="Movement">
            <label className="flex flex-col gap-1">
              <span className="panel-label">Speed scale · {speedScale.toFixed(2)}×</span>
              <input
                className="scrub"
                type="range"
                min={0.2}
                max={3}
                step={0.1}
                value={speedScale}
                style={{ ['--progress' as string]: String((speedScale - 0.2) / 2.8) }}
                onChange={(e) => setSpeedScale(Number(e.target.value))}
              />
            </label>
            <label className="mt-2 flex flex-col gap-1">
              <span className="panel-label">Duration override (s)</span>
              <input
                className="control"
                type="number"
                min={5}
                max={600}
                placeholder="scenario default"
                value={durationS}
                onChange={(e) => setDurationS(e.target.value === '' ? '' : Number(e.target.value))}
              />
            </label>
          </Panel>

          <Panel title="Application workload">
            <div className="space-y-1.5">
              {TRAFFIC_CLASSES.map((cls) => (
                <Toggle
                  key={cls}
                  checked={workload[cls]}
                  onChange={(next) => setWorkload((previous) => ({ ...previous, [cls]: next }))}
                >
                  {cls}
                </Toggle>
              ))}
            </div>
          </Panel>

          <Panel title="Inject network failure">
            <label className="flex flex-col gap-1">
              <span className="panel-label">Link</span>
              <select
                className="control"
                value={faultLink}
                onChange={(e) => setFaultLink(e.target.value as EngineLinkId | '')}
              >
                <option value="">none</option>
                {LINK_IDS.map((link) => (
                  <option key={link} value={link}>
                    {LINK_LABEL[link].label}
                  </option>
                ))}
              </select>
            </label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className="panel-label">At (s)</span>
                <input
                  className="control"
                  type="number"
                  min={0}
                  value={faultAt}
                  onChange={(e) => setFaultAt(Number(e.target.value) || 0)}
                  disabled={!faultLink}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="panel-label">For (s)</span>
                <input
                  className="control"
                  type="number"
                  min={0.5}
                  value={faultFor}
                  onChange={(e) => setFaultFor(Number(e.target.value) || 1)}
                  disabled={!faultLink}
                />
              </label>
            </div>
          </Panel>

          <Panel title="Congestion">
            <label className="flex flex-col gap-1">
              <span className="panel-label">Link</span>
              <select
                className="control"
                value={congestLink}
                onChange={(e) => setCongestLink(e.target.value as EngineLinkId | '')}
              >
                <option value="">none</option>
                {LINK_IDS.map((link) => (
                  <option key={link} value={link}>
                    {LINK_LABEL[link].label}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-2 flex flex-col gap-1">
              <span className="panel-label">
                Remaining capacity · {(congestFactor * 100).toFixed(0)}%
              </span>
              <input
                className="scrub"
                type="range"
                min={0.05}
                max={1}
                step={0.05}
                value={congestFactor}
                style={{ ['--progress' as string]: String(congestFactor) }}
                onChange={(e) => setCongestFactor(Number(e.target.value))}
                disabled={!congestLink}
              />
            </label>
          </Panel>
        </div>

        <div className="flex min-h-[440px] flex-col gap-3">
          {runId ? (
            <MissionScene
              source={run.source}
              t={run.state?.t ?? 0}
              duration={run.state?.duration_s ?? 100}
              playing={playing && !run.stale}
              className="min-h-[46vh] flex-1"
            />
          ) : (
            <div className="scene-shell grid min-h-[46vh] flex-1 place-items-center">
              <p className="max-w-sm p-6 text-center text-[13px] text-[color:var(--color-muted)]">
                Configure a scenario on the left, then <strong>Launch configured run</strong>.
              </p>
            </div>
          )}
          <AccessStrip event={run.latest} selected={selectedLink} onSelect={setSelectedLink} />
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <ApplicationHealthPanel event={run.latest} />
            <PipelineTimeline decisions={run.decisions} latest={run.latest} />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
