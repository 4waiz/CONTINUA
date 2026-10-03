'use client';

/**
 * The Mission dashboard - the flagship view.
 *
 * The world is the interface: the 3D scene runs edge to edge under a slim top
 * bar, and everything else floats over it on four surfaces - the access links
 * on the left, application health on the right, the camera under it, and one
 * dock along the bottom that holds the run itself (what to run, the transport,
 * the timeline, the controller's pipeline). Nothing scrolls the page.
 *
 * Two rules the redesign had to keep:
 *
 * 1. **Every control does something.** There are no decorative buttons, no
 *    placeholder tables and no hard-coded counters.
 * 2. **A value that does not exist is not a zero.** With no run, or with the
 *    engine down, the panels show a placeholder rule and say what they are
 *    waiting for. The scene still renders - from the Phase 1 preview source,
 *    badged `SCENE PREVIEW` - because an empty rectangle is a worse answer
 *    than an honest one.
 */

import { api, EngineApiError, type PolicySpec, type ScenarioSpec } from '@/lib/api';
import { useEngineRun } from '@/lib/useEngineRun';
import { EngineStatus } from '@/components/ui/EngineStatus';
import { IS_PUBLIC_PREVIEW } from '@/lib/deployment';
import { demoIndex, findDemoRun, type DemoRunSummary } from '@/lib/staticDemo';
import {
  CONTROL_MODE_LABEL,
  LINK_LABEL,
  actionsOf,
  controlModeOf,
  type EngineEvent,
  type EngineLinkId,
  type PolicyIdString,
} from '@continua/contracts/engine';
import { MISSION_ZONES, NETWORK_COLOR } from '@continua/scene';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppShell, RunStatusBar } from '../AppShell';
import { CinematicIcon, CloseIcon, CloseupIcon, FollowIcon, NetworkIcon, OverviewIcon, PlayIcon } from '../ui/icons';
import { ApplicationPanel } from './ApplicationPanel';
import { CameraFeed } from './CameraFeed';
import { FullscreenButton } from './FullscreenButton';
import { LinkStack } from './LinkStack';
import { MissionDock } from './MissionDock';
import { MissionScene, type MissionCamera } from './MissionScene';
import { RouteMap } from './RouteMap';
import { RunSummary } from './RunSummary';

const ZONE_LABEL: Record<string, string> = Object.fromEntries(MISSION_ZONES.map((zone) => [zone.id, zone.label]));

/** How long a handoff stays announced, in run seconds. */
const HANDOFF_VISIBLE_S = 5;

/**
 * The most recent path switch, if it happened within the last few run
 * seconds. Derived from the engine's decisions - the "from" link is the one
 * the previous decision recorded as carrying - never from UI state.
 */
function recentHandoff(decisions: EngineEvent[], latest: EngineEvent | null) {
  if (!latest) return null;
  for (let i = decisions.length - 1; i >= 0; i -= 1) {
    const event = decisions[i]!;
    if (latest.t - event.t > HANDOFF_VISIBLE_S) return null;
    if (event.t > latest.t + 0.05) continue;
    const switched = actionsOf(event).find((action) => action.kind === 'switch');
    if (!switched?.link) continue;
    const from = decisions[i - 1]?.carrying ?? null;
    if (from === switched.link) continue;
    return { at: event.t, from, to: switched.link, reason: event.reason, seq: event.seq };
  }
  return null;
}

/** How far before a linked decision a replay starts. */
const REPLAY_LEAD_S = 4;

/**
 * The policy a run is compared against: B0, a single link switched only after
 * it fails - what a session does without CONTINUA. Same scenario, route and
 * seed, so the exogenous trace is identical and the comparison is paired.
 */
const BASELINE_POLICY: PolicyIdString = 'B0';

type AppState = NonNullable<EngineEvent['app']>;

/** One run's session, as the receiver measures it: up or down, reconnects, time lost. */
function SessionChip({ label, app, tone }: { label: string; app: AppState; tone: string }) {
  return (
    <span
      className="hud-chip"
      style={{ color: app.in_outage ? 'var(--color-bad)' : 'var(--color-good)' }}
      title="Session state from the receiver: whether traffic is getting through now, how often the session has had to be re-established, and the time it has been down."
    >
      <span className="font-bold" style={{ color: tone }}>
        {label}
      </span>
      <span
        className={`h-2 w-2 rounded-full ${app.in_outage ? '' : 'breathe'}`}
        style={{ background: app.in_outage ? 'var(--color-bad)' : 'var(--color-good)' }}
      />
      {app.in_outage ? 'SESSION DOWN' : 'SESSION UP'}
      <span className="font-medium text-[color:var(--color-muted)]">
        <span className="hidden min-[1700px]:inline">
          · {app.session_reconnects} reconnect{app.session_reconnects === 1 ? '' : 's'}
        </span>{' '}
        · {app.outage_s.toFixed(1)} s down
      </span>
    </span>
  );
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
  // The preview opens on the director's cut; a run starts on the follow camera,
  // which keeps the link beams in frame - unless the viewer has chosen one.
  const [camera, setCamera] = useState<MissionCamera>('cinematic');
  const [introDismissed, setIntroDismissed] = useState(false);
  const [summary, setSummary] = useState<{ runId: string; metrics: Record<string, unknown> } | null>(null);
  const [summaryClosedFor, setSummaryClosedFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [bootAttempt, setBootAttempt] = useState(0);
  const [demoRuns, setDemoRuns] = useState<DemoRunSummary[]>([]);
  // Side by side with the reactive baseline, by default: the comparison is the
  // point. (A B0 run has nothing to be compared with.)
  const [compare, setCompare] = useState(true);
  const [startedBaselineId, setStartedBaselineId] = useState<string | null>(null);
  const [baselineSummary, setBaselineSummary] = useState<{ runId: string; metrics: Record<string, unknown> } | null>(null);

  /**
   * Which run is on screen. Locally that is whichever one the operator started.
   * On the public build every scenario-and-policy pair was recorded ahead of
   * time, so the selection *is* the run: derived here rather than pushed
   * through an effect, which would render one frame of the previous run first.
   */
  const runId = IS_PUBLIC_PREVIEW ? (findDemoRun(demoRuns, scenarioId, policyId)?.run_id ?? null) : startedRunId;

  const run = useEngineRun(runId);
  const comparing = compare && policyId !== BASELINE_POLICY;
  const baselineId = !comparing
    ? null
    : IS_PUBLIC_PREVIEW
      ? (findDemoRun(demoRuns, scenarioId, BASELINE_POLICY)?.run_id ?? null)
      : startedBaselineId;
  const baseline = useEngineRun(baselineId);
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
        setBootError(cause instanceof EngineApiError ? cause.message : 'Could not load scenarios from the engine.');
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
        if (!cancelled) setDemoRuns(index.runs);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setBootError(cause instanceof Error ? cause.message : 'Could not load the recorded runs.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Follow the carrying link unless the operator has pinned one. Derived during
  // render rather than synchronised from an effect.
  const carrying = run.latest?.carrying ?? null;
  const [pinned, setPinned] = useState(false);
  const activeLink: EngineLinkId = pinned ? selectedLink : (carrying ?? selectedLink);

  // A confirmation is worth one glance, not the rest of the session.
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

  // Deep link from the Decision Log: `/?replay=<run>&t=<seconds>` replays a
  // recorded run from just before that decision, so the handoff is seen to
  // happen rather than landed on. Read once, then dropped from the address bar
  // so a reload does not start a second replay.
  // A ref, not a cancellation flag: under React's development double-invoke
  // the second pass must neither start a second replay nor discard the first.
  const deepLinkHandled = useRef(false);
  useEffect(() => {
    if (IS_PUBLIC_PREVIEW || deepLinkHandled.current) return;
    deepLinkHandled.current = true;
    const params = new URLSearchParams(window.location.search);
    const source = params.get('replay');
    if (!source) return;
    const requested = Number(params.get('t') ?? '0');
    const at = Number.isFinite(requested) ? Math.max(0, requested - REPLAY_LEAD_S) : 0;
    window.history.replaceState(null, '', window.location.pathname);
    api
      .replay(source)
      .then(async (response) => {
        setStartedRunId(response.run_id);
        setStartedBaselineId(null);
        setPinned(false);
        if (at > 0) await api.controlRun(response.run_id, { action: 'seek', t: at });
        setNotice(`Replaying ${source} from t+${at.toFixed(0)}s.`);
      })
      .catch((cause: unknown) => setNotice(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  const start = useCallback(
    () =>
      act(async () => {
        const control = { scenario_id: scenarioId, policy_id: policyId, seed, speed: 1, predictor, horizon_s: 3 };
        // Started together, so the two runs' clocks stay level.
        const [response, baselineResponse] = await Promise.all([
          api.startRun({ control }),
          comparing ? api.startRun({ control: { ...control, policy_id: BASELINE_POLICY } }) : Promise.resolve(null),
        ]);
        setStartedRunId(response.run_id);
        setStartedBaselineId(baselineResponse?.run_id ?? null);
        setPinned(false);
        setCamera((current) => (current === 'cinematic' ? 'follow' : current));
      }, comparing ? 'Run started, with the reactive baseline beside it.' : 'Run started.'),
    [act, scenarioId, policyId, seed, predictor, comparing],
  );

  // Transport acts on both runs, so they stay at the same moment.
  const control = useCallback(
    (action: 'play' | 'pause' | 'reset' | 'stop', extra?: Record<string, number>) =>
      act(async () => {
        if (!runId) return;
        await Promise.all([
          api.controlRun(runId, { action, ...extra }),
          baselineId ? api.controlRun(baselineId, { action, ...extra }) : Promise.resolve(null),
        ]);
      }),
    [act, runId, baselineId],
  );

  const replay = useCallback(
    () =>
      act(async () => {
        if (!runId) throw new Error('Start a run first, then replay it.');
        const [response, baselineResponse] = await Promise.all([
          api.replay(runId),
          baselineId ? api.replay(baselineId) : Promise.resolve(null),
        ]);
        setStartedRunId(response.run_id);
        setStartedBaselineId(baselineResponse?.run_id ?? null);
      }, 'Replaying the recorded run.'),
    [act, runId, baselineId],
  );

  const seek = useCallback(
    (t: number) =>
      act(async () => {
        if (!runId) return;
        await Promise.all([
          api.controlRun(runId, { action: 'seek', t }),
          baselineId ? api.controlRun(baselineId, { action: 'seek', t }) : Promise.resolve(null),
        ]);
      }),
    [act, runId, baselineId],
  );

  // When a run finishes, fetch the metrics file the engine wrote for it - the
  // end-of-run card shows that, and only that.
  const completed = run.state?.status === 'completed';
  useEffect(() => {
    if (!runId || !completed) return undefined;
    let cancelled = false;
    api
      .getRunMetrics(runId)
      .then((metrics) => {
        if (!cancelled) setSummary({ runId, metrics });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [runId, completed]);
  const showSummary = summary !== null && summary.runId === runId && completed && summaryClosedFor !== runId;

  // The baseline's metrics too, once it has finished, for the side-by-side card.
  const baselineCompleted = baseline.state?.status === 'completed';
  useEffect(() => {
    if (!baselineId || !baselineCompleted) return undefined;
    let cancelled = false;
    api
      .getRunMetrics(baselineId)
      .then((metrics) => {
        if (!cancelled) setBaselineSummary({ runId: baselineId, metrics });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [baselineId, baselineCompleted]);
  const baselineMetrics = baselineSummary !== null && baselineSummary.runId === baselineId ? baselineSummary.metrics : null;

  // The baseline as it was at this run's moment - its own buffer, read at this
  // run's time, so the two are compared at the same point of the route.
  const baselineEvent = useMemo(
    () => (baselineId && run.latest ? baseline.source.eventAt(run.latest.t) : null),
    // `baseline.latest` changes whenever the baseline's buffer grows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [baselineId, baseline.source, baseline.latest, run.latest],
  );
  // Each run's whole timeline for the dock's tracks; `latest` changes as it grows.
  const runTrack = useMemo(
    () => (runId ? { events: run.source.timeline, version: run.latest?.seq ?? 0 } : null),
    [runId, run.source, run.latest],
  );
  const baselineTrack = useMemo(
    () => (baselineId ? { events: baseline.source.timeline, version: baseline.latest?.seq ?? 0 } : null),
    [baselineId, baseline.source, baseline.latest],
  );

  const scenario = useMemo(
    () => scenarios.find((s) => s.id === (run.state?.scenario_id ?? scenarioId)),
    [scenarios, run.state?.scenario_id, scenarioId],
  );

  const duration = run.state?.duration_s ?? scenario?.duration_s ?? 100;
  const t = run.state?.t ?? 0;
  const controlMode = controlModeOf(run.latest);
  const zone = run.latest?.vehicle?.zone ? (ZONE_LABEL[run.latest.vehicle.zone] ?? run.latest.vehicle.zone) : null;
  const handoff = useMemo(() => recentHandoff(run.decisions, run.latest), [run.decisions, run.latest]);

  return (
    <AppShell
      variant="immersive"
      bar={<RunStatusBar state={run.state} connection={run.connection} stale={run.stale} dropped={run.droppedSequences} />}
    >
      <div ref={stageRef} className="absolute inset-0 overflow-hidden bg-[color:var(--color-bg)]">
        <MissionScene
          source={run.source}
          t={t}
          duration={duration}
          playing={playing && !run.stale}
          className="scene-shell-bleed absolute inset-0 h-full w-full"
          preview={!runId}
          camera={camera}
          speed={run.state?.speed ?? 1}
        />

        {/* --- HUD: what the scene is showing, top centre ----------------------- */}
        <div className="pointer-events-none absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2">
          {runId && !baselineId ? (
            <span className="hud-chip" title="The scene is driven by engine events for this run.">
              <span className="h-2 w-2 rounded-full" style={{ background: 'var(--color-blue)' }} />
              PREDICTIVE HANDOFF
            </span>
          ) : runId ? null : (
            <span
              className="hud-chip text-[color:var(--color-warn)]"
              title="No run yet: the scene plays the deterministic Phase 1 preview. Nothing on screen is a measurement."
            >
              <span className="h-2 w-2 rounded-full" style={{ background: 'var(--color-warn)' }} />
              SCENE PREVIEW
            </span>
          )}
          {/* The zone is on the route map; without a run there is no map position, so say it here. */}
          {zone && !runId && <span className="hud-chip text-[color:var(--color-muted)]">{zone}</span>}
          {runId && run.latest && (
            <span
              className="hud-chip"
              style={{
                color: controlMode === 'teleop' ? 'var(--color-good)' : controlMode === 'waypoint' ? 'var(--color-warn)' : 'var(--color-bad)',
              }}
              title="Operating mode of the control class, chosen by the controller from receiver-side measurements. Policies without mode handover stay in teleop."
            >
              {CONTROL_MODE_LABEL[controlMode].toUpperCase()}
            </span>
          )}
          {carrying && (
            <span
              className={`hud-chip ${baselineId ? 'max-[1599px]:hidden!' : ''}`}
              style={{ color: NETWORK_COLOR[carrying] }}
            >
              <NetworkIcon link={carrying} size={14} />
              {LINK_LABEL[carrying].label} carrying
            </span>
          )}
          {/* Beside the baseline: both sessions, as their receivers measure them. */}
          {runId && baselineId && run.latest?.app && <SessionChip label="CONTINUA" app={run.latest.app} tone="var(--color-blue)" />}
          {runId && baselineId && baselineEvent?.app && (
            <SessionChip label="REACTIVE" app={baselineEvent.app} tone="var(--color-muted)" />
          )}
          {/* The promise, as the receiver measures it: is the session up, and
              has it ever had to reconnect? */}
          {runId && !baselineId && run.latest?.app && (
            <span
              className="hud-chip"
              style={{ color: run.latest.app.in_outage ? 'var(--color-bad)' : 'var(--color-good)' }}
              title="Session state from the receiver: whether traffic is getting through now, and how often the session has had to be re-established."
            >
              <span
                className={`h-2 w-2 rounded-full ${run.latest.app.in_outage ? '' : 'breathe'}`}
                style={{ background: run.latest.app.in_outage ? 'var(--color-bad)' : 'var(--color-good)' }}
              />
              {run.latest.app.in_outage ? 'SESSION INTERRUPTED' : 'SESSION CONTINUOUS'}
              <span className="font-medium text-[color:var(--color-muted)]">
                · {run.latest.app.session_reconnects} reconnect{run.latest.app.session_reconnects === 1 ? '' : 's'}
              </span>
            </span>
          )}
        </div>

        {/* --- handoff announcement ------------------------------------------------ */}
        {handoff && (
          <div className="pointer-events-none absolute top-[54px] left-1/2 z-10 w-[min(560px,46vw)] -translate-x-1/2" role="status">
            <div className="glass drop-in relative flex items-center gap-3 overflow-hidden px-4 py-2.5" key={handoff.seq}>
              <span
                aria-hidden
                className="countdown absolute bottom-0 left-0 h-[2px] w-full"
                style={{ background: NETWORK_COLOR[handoff.to], animationDuration: `${HANDOFF_VISIBLE_S}s` }}
              />
              <span className="flex shrink-0 items-center gap-1.5">
                {handoff.from && (
                  <span className="grid h-7 w-7 place-items-center rounded-full" style={{ background: `color-mix(in srgb, ${NETWORK_COLOR[handoff.from]} 14%, white)`, color: NETWORK_COLOR[handoff.from] }}>
                    <NetworkIcon link={handoff.from} size={15} />
                  </span>
                )}
                <span className="text-[13px] text-[color:var(--color-faint)]">→</span>
                <span className="grid h-7 w-7 place-items-center rounded-full text-white" style={{ background: NETWORK_COLOR[handoff.to] }}>
                  <NetworkIcon link={handoff.to} size={15} />
                </span>
              </span>
              <div className="min-w-0">
                <div className="text-[12.5px] font-semibold">
                  Session moved{handoff.from ? ` from ${LINK_LABEL[handoff.from].label}` : ''} to {LINK_LABEL[handoff.to].label}
                  <span className="ml-1.5 font-normal text-[color:var(--color-faint)]">t+{handoff.at.toFixed(1)}s</span>
                </div>
                <div className="truncate text-[11.5px] text-[color:var(--color-muted)]">{handoff.reason}</div>
              </div>
            </div>
          </div>
        )}

        {/* --- first visit: what this is, and the one thing to do ---------------------- */}
        {!IS_PUBLIC_PREVIEW && !runId && !bootError && scenarios.length > 0 && !introDismissed && (
          <section
            className="glass absolute top-[56px] left-1/2 z-10 w-[min(560px,44vw)] -translate-x-1/2 px-5 py-4"
            aria-label="Introduction"
          >
            <button
              type="button"
              className="absolute top-2.5 right-2.5 grid h-7 w-7 place-items-center rounded-full text-[color:var(--color-faint)] hover:bg-[color:var(--color-surface-muted)] hover:text-[color:var(--color-ink)]"
              aria-label="Dismiss introduction"
              onClick={() => setIntroDismissed(true)}
            >
              <CloseIcon size={14} />
            </button>
            <h2 className="pr-8 text-[17px] font-semibold tracking-[-0.015em]">
              The network changes. <span className="text-[color:var(--color-blue)]">The session doesn&apos;t.</span>
            </h2>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-[color:var(--color-muted)]">
              A response rover leaves a wired dock and drives through Wi-Fi and cellular coverage into a
              satellite-served sector. The CONTINUA controller moves the session between the four links before each
              one fails; every decision is logged with the measurements it was based on.
              {comparing && (
                <>
                  {' '}
                  A reactive controller, which switches only after a link has failed, drives the same route and seed
                  beside it - watch the two camera halves at each handover.
                </>
              )}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2.5">
              <button type="button" className="control control-primary" onClick={start} disabled={busy}>
                <PlayIcon size={14} /> Start the mission
              </button>
              <span className="text-[11.5px] text-[color:var(--color-faint)]">
                {scenario?.title ?? scenarioId} · {policyId} · seed {seed} - change them in the bar below
              </span>
            </div>
          </section>
        )}

        {showSummary && runId && (
          <RunSummary
            baseline={baselineMetrics ? { metrics: baselineMetrics, policy: BASELINE_POLICY } : null}
            metrics={summary.metrics}
            title={scenario?.title ?? run.state?.scenario_id ?? scenarioId}
            policy={run.state?.policy_id ?? policyId}
            seed={run.state?.seed ?? null}
            onReplay={() => {
              setSummaryClosedFor(runId);
              void replay();
            }}
            onClose={() => setSummaryClosedFor(runId)}
          />
        )}

        {/* --- engine offline ------------------------------------------------------- */}
        {bootError && !IS_PUBLIC_PREVIEW && (
          <div className="absolute top-[54px] left-1/2 z-20 w-[min(640px,52vw)] -translate-x-1/2">
            <EngineStatus detail={bootError} retrying={busy} onRetry={() => setBootAttempt((n) => n + 1)} />
          </div>
        )}

        {/* --- left: access links ---------------------------------------------------- */}
        <aside className="mission-side mission-left scroll-y enter">
          <LinkStack
            event={run.latest}
            history={run.history}
            selected={activeLink}
            onSelect={(link) => {
              setSelectedLink(link);
              setPinned(true);
            }}
          />
          {pinned && (
            <button
              type="button"
              className="control mt-2 w-full"
              onClick={() => setPinned(false)}
              title="Return to automatically following whichever link is carrying the session"
            >
              Pinned to {LINK_LABEL[activeLink].label} · follow carrying link
            </button>
          )}
        </aside>

        {/* --- right: route, application health, camera ---------------------------------- */}
        <aside className="mission-side mission-right scroll-y enter-late flex flex-col gap-3 *:shrink-0">
          <RouteMap event={run.latest} events={run.decisions} />
          <ApplicationPanel event={run.latest} />
          <CameraFeed event={run.latest} baseline={baselineId ? baselineEvent : undefined} />
        </aside>

        {/* --- bottom: the run ---------------------------------------------------------- */}
        <div className="mission-dock">
          <MissionDock
            scenarios={scenarios}
            policies={policies}
            scenarioId={scenarioId}
            policyId={policyId}
            seed={seed}
            onScenario={(id) => {
              setScenarioId(id);
              setPinned(false);
            }}
            onPolicy={(id) => {
              setPolicyId(id);
              setPinned(false);
            }}
            onSeed={setSeed}
            runId={runId}
            playing={playing}
            busy={busy}
            speed={run.state?.speed ?? 1}
            t={t}
            duration={duration}
            latest={run.latest}
            decisions={run.decisions}
            history={run.history}
            onStart={start}
            onToggle={() => control(playing ? 'pause' : 'play')}
            onReset={() => control('reset')}
            onReplay={replay}
            onSpeed={(speed) => control('play', { speed })}
            onSeek={seek}
            compare={comparing}
            onCompare={setCompare}
            track={runTrack}
            baseline={baselineTrack}
            extra={
              <>
                <CameraSwitch value={camera} onChange={setCamera} />
                <FullscreenButton target={stageRef} />
              </>
            }
          />
        </div>

        {(notice || (run.connection === 'disconnected' && runId)) && (
          <div className="pointer-events-none absolute bottom-[148px] left-1/2 z-20 -translate-x-1/2" role="status">
            <p className="glass px-4 py-2 text-[12.5px]">
              {run.connection === 'disconnected' && runId ? (
                <>
                  <strong className="text-[color:var(--color-bad)]">Backend disconnected.</strong> Values shown are the last
                  received, not current. Reconnecting (attempt {run.reconnectAttempts})…
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

const CAMERAS: { id: MissionCamera; label: string; Icon: typeof FollowIcon }[] = [
  { id: 'cinematic', label: 'Cinematic camera', Icon: CinematicIcon },
  { id: 'follow', label: 'Follow camera', Icon: FollowIcon },
  { id: 'overview', label: 'Overview camera', Icon: OverviewIcon },
  { id: 'closeup', label: 'Close-up camera', Icon: CloseupIcon },
];

/** Three viewpoints on the same run. A camera changes the picture, never the data. */
function CameraSwitch({ value, onChange }: { value: MissionCamera; onChange: (camera: MissionCamera) => void }) {
  return (
    <div
      role="group"
      aria-label="Camera"
      className="pointer-events-auto flex shrink-0 items-center gap-0.5 rounded-[11px] border border-[color:var(--color-line)] bg-[color:var(--color-surface)] p-[2px]"
    >
      {CAMERAS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          title={label}
          aria-label={label}
          aria-pressed={value === id}
          onClick={() => onChange(id)}
          className="grid h-[30px] w-[30px] place-items-center rounded-[9px] transition-colors"
          style={{
            background: value === id ? 'color-mix(in srgb, var(--color-blue) 11%, white)' : 'transparent',
            color: value === id ? 'var(--color-blue)' : 'var(--color-muted)',
          }}
        >
          <Icon size={16} />
        </button>
      ))}
    </div>
  );
}
