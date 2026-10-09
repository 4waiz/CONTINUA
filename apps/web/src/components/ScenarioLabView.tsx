'use client';
/* Copyright (c) 2026 Kanban Studios F.Z.E. All rights reserved. Proprietary - see LICENSE. KS-CONTINUA-BE259A46EAB9 */

/**
 * Scenario Lab - build a run, then watch it.
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
import { deadZonesFromFaults } from '@continua/scene';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell, RunStatusBar } from './AppShell';
import { LinkPills } from './mission/LinkPills';
import { Pipeline } from './mission/MissionDock';
import { MissionScene } from './mission/MissionScene';
import { RouteMap } from './mission/RouteMap';
import { PageTour } from './onboarding/PageTour';
import { SCENARIO_TOUR } from './onboarding/tours';
import {
  FaultSection,
  Field,
  POLICY_LABEL,
  PolicySelector,
  ScenarioCard,
  WorkloadChip,
} from './scenario/controls';
import { EngineStatus } from './ui/EngineStatus';
import { PreviewNote } from './ui/PreviewNote';
import { IS_PUBLIC_PREVIEW } from '@/lib/deployment';
import { demoIndex, findDemoRun, type DemoRunSummary } from '@/lib/staticDemo';
import { GlassSection } from './ui/primitives';
import { PauseIcon, PlayIcon, ResetIcon } from './ui/icons';

export function ScenarioLabView() {
  const [scenarios, setScenarios] = useState<ScenarioSpec[]>([]);
  const [policies, setPolicies] = useState<PolicySpec[]>([]);
  const [scenarioId, setScenarioId] = useState('baseline-journey');
  const [policyId, setPolicyId] = useState<PolicyIdString>('P1');
  const [seed, setSeed] = useState(7);
  const [startedRunId, setStartedRunId] = useState<string | null>(null);
  const [demoRuns, setDemoRuns] = useState<DemoRunSummary[]>([]);
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

  const [bootAttempt, setBootAttempt] = useState(0);

  /**
   * Which run is on screen. Locally it is the one `launch` composed. On the
   * public build every scenario-and-policy pair was recorded ahead of time, so
   * the tiles resolve straight to a recording - derived during render, because
   * synchronising it from an effect renders one frame of the previous run.
   */
  const runId = IS_PUBLIC_PREVIEW
    ? (findDemoRun(demoRuns, scenarioId, policyId)?.run_id ?? null)
    : startedRunId;

  useEffect(() => {
    if (!IS_PUBLIC_PREVIEW) return;
    let cancelled = false;
    demoIndex()
      .then((index) => {
        if (!cancelled) setDemoRuns(index.runs);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const run = useEngineRun(runId);
  const playing = run.state?.status === 'running';

  useEffect(() => {
    Promise.all([api.scenarios(), api.policies()])
      .then(([s, p]) => {
        setScenarios(s.scenarios);
        setPolicies(p.policies);
      })
      .then(() => setError(null))
      .catch((cause: unknown) =>
        setError(cause instanceof EngineApiError ? cause.message : 'Engine unreachable.'),
      );
  }, [bootAttempt]);

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
      setStartedRunId(response.run_id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [scenarioId, policyId, seed, workload, speedScale, durationS, faultLink, faultAt, faultFor, congestLink, congestFactor]);

  const selectedScenario = scenarios.find((entry) => entry.id === scenarioId);
  // The scenario's cuttings stand in the world; a reversed run is drawn from the far end.
  const deadZones = useMemo(() => deadZonesFromFaults(selectedScenario?.faults), [selectedScenario]);
  const reverse = Boolean(selectedScenario?.reverse);
  useEffect(() => {
    run.source.setReverse(reverse);
  }, [run.source, reverse]);
  const enabledWorkloads = TRAFFIC_CLASSES.filter((cls) => workload[cls]);

  /**
   * The summary is a plain restatement of what is on screen - no predicted
   * outcome, because a single run does not have one.
   *
   * Which configuration it restates depends on where the run came from. Locally
   * it is the form above, so the operator can check what they are about to
   * launch without re-reading four panels. On the public build the run was
   * recorded before the visitor arrived, so the form is hidden and the numbers
   * are read off the run itself - otherwise the seed box's default would sit
   * here claiming to be the seed of a recording made at 70009.
   */
  const summaryRows: [string, string][] = IS_PUBLIC_PREVIEW
    ? [
        ['Scenario', run.state?.scenario_title ?? selectedScenario?.title ?? ' - '],
        ['Route', 'Facility → field → remote'],
        ['Duration', run.state ? `${Math.round(run.state.duration_s)} s` : ' - '],
        ['Workloads', 'all 5 classes'],
        ['Policy', `${policyId} · ${POLICY_LABEL[policyId]?.name ?? policyId}`],
        ['Predictor', run.state?.predictor ?? 'heuristic-trend'],
        ['Seed', run.state ? String(run.state.seed) : ' - '],
        ['Recorded', run.state?.source?.recorded_at?.slice(0, 10) ?? ' - '],
      ]
    : [
        ['Scenario', selectedScenario?.title ?? ' - '],
        ['Route', 'Facility → field → remote'],
        [
          'Duration',
          durationS === '' ? `${selectedScenario?.duration_s ?? ' - '} s (default)` : `${durationS} s`,
        ],
        ['Workloads', `${enabledWorkloads.length} of ${TRAFFIC_CLASSES.length} enabled`],
        ['Policy', `${policyId} · ${POLICY_LABEL[policyId]?.name ?? policyId}`],
        ['Predictor', 'heuristic-trend'],
        ['Seed', String(seed)],
        [
          'Faults',
          faultLink || congestLink
            ? [
                faultLink
                  ? `${LINK_LABEL[faultLink].label} down @ ${faultAt}s for ${faultFor}s`
                  : null,
                congestLink
                  ? `${LINK_LABEL[congestLink].label} at ${Math.round(congestFactor * 100)} % capacity`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')
            : 'none',
        ],
      ];

  const runControls = runId ? (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className="control flex-1"
        data-active={playing}
        onClick={() => api.controlRun(runId, { action: playing ? 'pause' : 'play' }).catch(() => undefined)}
      >
        {playing ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
        {playing ? 'Pause' : 'Play'}
      </button>
      <button
        type="button"
        className="control flex-1"
        onClick={() => api.controlRun(runId, { action: 'reset' }).catch(() => undefined)}
      >
        <ResetIcon size={15} /> Restart
      </button>
    </div>
  ) : null;

  return (
    <AppShell
      variant="immersive"
      bar={<RunStatusBar state={run.state} connection={run.connection} stale={run.stale} dropped={run.droppedSequences} />}
    >
      <div className="absolute inset-0 overflow-hidden" style={{ ['--dock-h' as string]: '60px' }}>
        <MissionScene
          source={run.source}
          t={run.state?.t ?? 0}
          duration={run.state?.duration_s ?? (durationS === '' ? 100 : Number(durationS))}
          playing={playing && !run.stale}
          className="scene-shell-bleed absolute inset-0 h-full w-full"
          preview={!runId}
          speed={run.state?.speed ?? 1}
          deadZones={deadZones}
        />

        <div className="pointer-events-none absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2">
          <span className="hud-chip" style={{ color: runId ? 'var(--color-blue)' : 'var(--color-warn)' }}>
            <span className="h-2 w-2 rounded-full" style={{ background: runId ? 'var(--color-blue)' : 'var(--color-warn)' }} />
            {runId ? 'LAB RUN' : 'SCENE PREVIEW'}
          </span>
          <span className="hud-chip text-[color:var(--color-muted)]">{selectedScenario?.title ?? 'Select a scenario'}</span>
          <Link
            href="/scene-lab"
            className="hud-chip pointer-events-auto text-[color:var(--color-blue)] no-underline"
            title="The 3D world on its own: cameras, quality tiers, the rover up close"
          >
            3D workbench
          </Link>
        </div>

        {/* ---------------- configuration ---------------- */}
        <aside className="mission-side scroll-y left-[var(--edge)] w-[352px] max-[1500px]:w-[316px]">
          <div className="flex flex-col gap-3">
            {IS_PUBLIC_PREVIEW ? (
              <PreviewNote />
            ) : (
              error && <EngineStatus detail={error} onRetry={() => setBootAttempt((n) => n + 1)} retrying={busy} />
            )}
            <div className="glass divide-y divide-[color:var(--color-line)]">
              <GlassSection title="Base scenario" tour="lab-scenarios">
                <div className="grid grid-cols-2 gap-1.5">
                  {scenarios.map((entry) => (
                    <ScenarioCard
                      key={entry.id}
                      title={entry.title}
                      // Only the chosen tile explains itself; eight descriptions
                      // at once were a wall of grey text.
                      description={entry.id === scenarioId ? entry.description : undefined}
                      selected={entry.id === scenarioId}
                      onSelect={() => setScenarioId(entry.id)}
                    />
                  ))}
                  {scenarios.length === 0 && (
                    <p className="col-span-2 text-[12px] text-[color:var(--color-muted)]">
                      No scenarios - the engine is not reachable.
                    </p>
                  )}
                </div>
              </GlassSection>

              <GlassSection title="Policy under test" tour="lab-policy">
                <PolicySelector policies={policies} value={policyId} onChange={setPolicyId} />
              </GlassSection>

              {/* The sections below build a derived scenario spec, which is a run
                  that has to be executed. Hidden on the public build. */}
              {!IS_PUBLIC_PREVIEW && (
                <>
                  <GlassSection title="Application workloads">
                    <div
                      className="flex flex-wrap gap-1.5"
                      title="Disabled classes generate no traffic, so they neither compete for capacity nor appear in the application-health score."
                    >
                      {TRAFFIC_CLASSES.map((cls) => (
                        <WorkloadChip
                          key={cls}
                          id={cls}
                          enabled={workload[cls]}
                          onToggle={() => setWorkload((current) => ({ ...current, [cls]: !current[cls] }))}
                        />
                      ))}
                    </div>
                  </GlassSection>

                  <GlassSection title="Run parameters">
                    <div className="grid grid-cols-3 gap-2.5">
                      <Field label="Seed">
                        <input
                          className="control w-full"
                          type="number"
                          min={0}
                          max={2147483647}
                          value={seed}
                          onChange={(event) => setSeed(Number(event.target.value) || 0)}
                        />
                      </Field>
                      <Field label="Speed x">
                        <input
                          className="control w-full"
                          type="number"
                          min={0.25}
                          max={4}
                          step={0.25}
                          value={speedScale}
                          onChange={(event) => setSpeedScale(Number(event.target.value) || 1)}
                        />
                      </Field>
                      <Field label="Duration s">
                        <input
                          className="control w-full"
                          type="number"
                          min={10}
                          max={600}
                          placeholder="default"
                          value={durationS}
                          onChange={(event) => setDurationS(event.target.value === '' ? '' : Number(event.target.value))}
                        />
                      </Field>
                    </div>
                  </GlassSection>

                  <div className="px-3 py-3">
                    <FaultSection>
                      <div className="flex flex-col gap-2.5">
                        <div className="grid grid-cols-3 gap-2">
                          <Field label="Link down">
                            <select
                              className="control w-full"
                              value={faultLink}
                              onChange={(event) => setFaultLink(event.target.value as EngineLinkId | '')}
                            >
                              <option value="">none</option>
                              {LINK_IDS.map((link) => (
                                <option key={link} value={link}>
                                  {LINK_LABEL[link].label}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field label="At s">
                            <input
                              className="control w-full"
                              type="number"
                              min={0}
                              value={faultAt}
                              onChange={(event) => setFaultAt(Number(event.target.value) || 0)}
                              disabled={!faultLink}
                            />
                          </Field>
                          <Field label="For s">
                            <input
                              className="control w-full"
                              type="number"
                              min={1}
                              value={faultFor}
                              onChange={(event) => setFaultFor(Number(event.target.value) || 1)}
                              disabled={!faultLink}
                            />
                          </Field>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <Field label="Congest link">
                            <select
                              className="control w-full"
                              value={congestLink}
                              onChange={(event) => setCongestLink(event.target.value as EngineLinkId | '')}
                            >
                              <option value="">none</option>
                              {LINK_IDS.map((link) => (
                                <option key={link} value={link}>
                                  {LINK_LABEL[link].label}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field label="Capacity left">
                            <select
                              className="control w-full"
                              value={congestFactor}
                              onChange={(event) => setCongestFactor(Number(event.target.value))}
                              disabled={!congestLink}
                            >
                              {[0.1, 0.2, 0.3, 0.5, 0.7].map((factor) => (
                                <option key={factor} value={factor}>
                                  {Math.round(factor * 100)} %
                                </option>
                              ))}
                            </select>
                          </Field>
                        </div>
                      </div>
                    </FaultSection>
                  </div>
                </>
              )}
            </div>
          </div>
        </aside>

        {/* ---------------- summary and launch ---------------- */}
        <aside className="mission-side mission-right scroll-y flex flex-col gap-3 *:shrink-0">
          {runId && <RouteMap event={run.latest} events={run.decisions} />}
          <div className="glass divide-y divide-[color:var(--color-line)]" data-tour="lab-summary">
            <GlassSection title="Scenario summary">
              <dl className="flex flex-col gap-2">
                {summaryRows.map(([label, value]) => (
                  <div key={label} className="flex items-baseline justify-between gap-3">
                    <dt className="shrink-0 text-[11.5px] text-[color:var(--color-muted)]">{label}</dt>
                    <dd className="text-right text-[12.5px] font-semibold leading-snug">{value}</dd>
                  </div>
                ))}
              </dl>
            </GlassSection>
            <GlassSection title="What this run measures">
              <ul className="flex flex-col gap-1.5 text-[12px] leading-snug text-[color:var(--color-muted)]">
                <li>Total interruption and session reconnects.</li>
                <li>Per-class deadline attainment and p95 latency.</li>
                <li>Satellite bytes and relative link cost.</li>
                <li>Handovers performed, including unnecessary ones.</li>
              </ul>
            </GlassSection>
            <div className="flex flex-col gap-2 px-4 py-3.5">
              {/* Composing a run is the one verb the public build does not have,
                  so it does not get the page's biggest button. */}
              {!IS_PUBLIC_PREVIEW && (
                <button
                  type="button"
                  className="control control-primary h-11 w-full text-[14.5px]"
                  onClick={launch}
                  disabled={busy || scenarios.length === 0}
                >
                  <PlayIcon size={15} /> Run scenario
                </button>
              )}
              {runControls}
            </div>
          </div>
        </aside>

        {/* ---------------- live strip ---------------- */}
        <div className="mission-dock">
          <section className="glass flex items-center gap-3 px-3 py-2" aria-label="Live run" data-tour="lab-live">
            <LinkPills event={run.latest} />
            <span className="divider-v" />
            <Pipeline event={run.latest} />
          </section>
        </div>
        <PageTour
          id="scenario-builder"
          steps={SCENARIO_TOUR}
          label="A tour of the scenario builder"
          offer="Four steps: choose a road and who drives it, and watch the controller at work."
        />
      </div>
    </AppShell>
  );
}
