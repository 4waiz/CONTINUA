'use client';

/**
 * The Mission page - the flagship view.
 *
 * * **Landing.** What this is, in two sentences, over a still island; one way
 *   in, and the thirty-second intro beside it. Nothing moves until one is
 *   pressed.
 * * **Drive.** The run that shows what CONTINUA is for - the shadowed route,
 *   CONTINUA with its road map beside the normal rover - starts at once, and
 *   is then yours to change and scrub: in plain words by default, every
 *   measurement one toggle away (Details). Each change of network is shown -
 *   the camera flies out to where the new link comes from and back along it
 *   to the rover - and said aloud. W A S D take the wheel (`useDrive.ts`): the
 *   rover goes where it is steered, on the road, and every panel shows the
 *   recorded run at the rover's point of the road.
 * * **The story** (`?story`, the link to send someone, or the landing's second
 *   button). The thirty-second intro (`StoryFilm.tsx`); its "Replay it in 3D"
 *   plays the same run as a guided minute (`story.tsx`): captions read aloud,
 *   the framing chosen for each chapter, and the stored twenty-trial
 *   comparison at the end.
 *
 * The world is the interface in all three: the 3D scene runs edge to edge
 * under a slim top bar, and everything else floats over it.
 *
 * Two rules the redesigns have kept:
 *
 * 1. **Every control does something.** No decorative buttons, no placeholder
 *    tables, no hard-coded counters.
 * 2. **A value that does not exist is not a zero.** With no run, or with the
 *    engine down, panels say what they are waiting for. The scene still renders
 *    - from the Phase 1 preview source, badged `SCENE PREVIEW` - because an
 *    empty rectangle is a worse answer than an honest one.
 */

import { api, EngineApiError, type PolicySpec, type ScenarioSpec } from '@/lib/api';
import { useEngineRun } from '@/lib/useEngineRun';
import { EngineStatus } from '@/components/ui/EngineStatus';
import { Chip } from '@/components/ui/primitives';
import { IS_PUBLIC_PREVIEW } from '@/lib/deployment';
import { demoIndex, findDemoRun, type DemoRunSummary } from '@/lib/staticDemo';
import {
  CONTROL_MODE_LABEL,
  LINK_LABEL,
  actionsOf,
  controlModeOf,
  type EngineEvent,
  type EngineLinkId,
  type EngineRunState,
  type PolicyIdString,
} from '@continua/contracts/engine';
import { deadZonesFromFaults, MISSION_ZONES, NETWORK_COLOR, route, SITES } from '@continua/scene';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppShell, RunStatusBar } from '../AppShell';
import {
  CinematicIcon,
  CloseupIcon,
  CoverageIcon,
  FlightIcon,
  FollowIcon,
  NetworkIcon,
  OverviewIcon,
  SpeakerIcon,
  SpeakerOffIcon,
  SteeringIcon,
} from '../ui/icons';
import { ApplicationPanel } from './ApplicationPanel';
import { CameraFeed } from './CameraFeed';
import { DriveHud } from './DriveHud';
import { FullscreenButton } from './FullscreenButton';
import { HeadToHead } from './HeadToHead';
import { LinkStack } from './LinkStack';
import { MissionDock } from './MissionDock';
import { MissionScene, type MissionCamera } from './MissionScene';
import { Moment, type MomentSpec } from './Moment';
import { connectionState, handoffWhy, NETWORK, spokenLines, STRATEGY, warningWords } from './plain';
import { RoadAhead, useRadioMap } from './RoadAhead';
import { RouteMap } from './RouteMap';
import { RoverStatus } from './RoverStatus';
import { RunSummary } from './RunSummary';
import { StoryBar, STORY_POLICY, STORY_SCENARIO, useStoryDirector } from './story';
import { proofSentence, StoryLanding, StoryProof, useProofRows } from './StoryCards';
import { StoryFilm } from './StoryFilm';
import { useDrive } from './useDrive';
import { narrator, useNarrator } from './voice';

/** Whoever asked the system for less motion gets no camera flights until they turn them on. */
function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

const ZONE_LABEL: Record<string, string> = Object.fromEntries(MISSION_ZONES.map((zone) => [zone.id, zone.label]));

/** How long a handoff stays announced, in run seconds. */
const HANDOFF_VISIBLE_S = 5;

/** How long the road map's warning stays up at most, in run seconds - less if its network takes over first. */
const WARNING_VISIBLE_S = 8;

/** How long the bar waits, with nothing touched, before it steps aside for the picture. */
const BAR_IDLE_MS = 3500;

/** The story's seed: any would do; this one is the one the story was written against. */
const STORY_SEED = 1;

type View = 'landing' | 'story' | 'drive';

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
    return { at: event.t, from, to: switched.link, event, seq: event.seq };
  }
  return null;
}

/** How far before a linked decision a replay starts. */
const REPLAY_LEAD_S = 4;

/**
 * The policy a run is compared against: B0, a single link switched only after
 * it fails - what a session does without CONTINUA, "the normal rover". Same
 * scenario, route and seed, so the exogenous trace is identical and the
 * comparison is paired.
 */
const BASELINE_POLICY: PolicyIdString = 'B0';

/** Where the run starts: `?drive` opens the controls. (`?story` opens the story film - see below.) */
function initialView(): View {
  if (typeof window === 'undefined') return 'landing';
  const params = new URLSearchParams(window.location.search);
  if (params.has('drive') || params.has('replay')) return 'drive';
  return 'landing';
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
  // The landing opens on the director's cut; a run starts on the follow camera,
  // which keeps the link beams in frame - unless the viewer has chosen one.
  const [camera, setCamera] = useState<MissionCamera>('cinematic');
  const [view, setView] = useState<View>(initialView);
  const [detail, setDetail] = useState(false);
  // The run's settings, in a popover over the bar.
  const [settingsOpen, setSettingsOpen] = useState(false);
  // While a run plays untouched the bar steps aside; any movement brings it back.
  const [barIdle, setBarIdle] = useState(false);
  const [barHeld, setBarHeld] = useState(false);
  const [summary, setSummary] = useState<{ runId: string; metrics: Record<string, unknown> } | null>(null);
  const [summaryClosedFor, setSummaryClosedFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [bootAttempt, setBootAttempt] = useState(0);
  const [demoRuns, setDemoRuns] = useState<DemoRunSummary[]>([]);
  // The story as a one-minute film, over the scene.
  const [filmOpen, setFilmOpen] = useState(false);
  // Side by side with the normal rover, by default: the comparison is the
  // point. (A B0 run has nothing to be compared with.)
  const [compare, setCompare] = useState(true);
  const [startedBaselineId, setStartedBaselineId] = useState<string | null>(null);
  const [baselineSummary, setBaselineSummary] = useState<{ runId: string; metrics: Record<string, unknown> } | null>(null);
  // The story's own transport: paused by the viewer, or hurrying to the next chapter.
  const [storyPaused, setStoryPaused] = useState(false);
  const [skippingFrom, setSkippingFrom] = useState<string | null>(null);
  const [storyTake, setStoryTake] = useState(0);
  // The camera flies out to each new link - unless the system asks for less motion.
  const [flights, setFlights] = useState(() => !prefersReducedMotion());
  // Where each network reaches, drawn on the ground.
  const [coverage, setCoverage] = useState(false);

  /**
   * Which run is on screen. Locally that is whichever one the operator started.
   * On the public build every scenario-and-policy pair was recorded ahead of
   * time, so the selection *is* the run - once the viewer has chosen to watch
   * or drive: the landing shows the world, not a recording already under way.
   */
  const runId = IS_PUBLIC_PREVIEW
    ? view === 'landing'
      ? null
      : (findDemoRun(demoRuns, scenarioId, policyId)?.run_id ?? null)
    : startedRunId;

  const run = useEngineRun(runId);
  const comparing = compare && policyId !== BASELINE_POLICY;
  const baselineId = !comparing
    ? null
    : IS_PUBLIC_PREVIEW
      ? view === 'landing'
        ? null
        : (findDemoRun(demoRuns, scenarioId, BASELINE_POLICY)?.run_id ?? null)
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

  const [pinned, setPinned] = useState(false);

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
        setCamera('follow');
        if (at > 0) await api.controlRun(response.run_id, { action: 'seek', t: at });
        setNotice(`Replaying ${source} from t+${at.toFixed(0)}s.`);
      })
      .catch((cause: unknown) => setNotice(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  /**
   * Stop runs the page has moved on from. A pair replaced by a new one, or by
   * its replay, used to play on to its end with nobody watching - its stream,
   * its writes and its memory all competing with the pair on screen.
   */
  const retire = useCallback((ids: (string | null)[], keep: (string | null)[]) => {
    for (const id of ids) {
      if (id && !keep.includes(id)) void api.controlRun(id, { action: 'stop' }).catch(() => undefined);
    }
  }, []);

  /** Start a run - and the normal rover beside it, when comparing - on the engine. */
  const startWith = useCallback(
    (options: { scenario: string; policy: PolicyIdString; seed: number; compare: boolean }, message?: string) =>
      act(async () => {
        const control = {
          scenario_id: options.scenario,
          policy_id: options.policy,
          seed: options.seed,
          speed: 1,
          predictor,
          horizon_s: 3,
        };
        // Started together, so the two runs' clocks stay level.
        const [response, baselineResponse] = await Promise.all([
          api.startRun({ control }),
          options.compare && options.policy !== BASELINE_POLICY
            ? api.startRun({ control: { ...control, policy_id: BASELINE_POLICY } })
            : Promise.resolve(null),
        ]);
        setStartedRunId(response.run_id);
        setStartedBaselineId(baselineResponse?.run_id ?? null);
        setPinned(false);
        retire([startedRunId, startedBaselineId], [response.run_id, baselineResponse?.run_id ?? null]);
      }, message),
    [act, predictor, retire, startedRunId, startedBaselineId],
  );

  const start = useCallback(() => {
    setView('drive');
    setCamera((current) => (current === 'cinematic' || current === 'story' ? 'follow' : current));
    return startWith(
      { scenario: scenarioId, policy: policyId, seed, compare: comparing },
      comparing ? 'Run started, with the normal rover beside it.' : 'Run started.',
    );
  }, [startWith, scenarioId, policyId, seed, comparing]);

  // Transport acts on both runs, so they stay at the same moment.
  const control = useCallback(
    (action: 'play' | 'pause' | 'reset' | 'stop' | 'speed', extra?: Record<string, number>) =>
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
        retire([runId, baselineId], [response.run_id, baselineResponse?.run_id ?? null]);
      }, 'Replaying the recorded run.'),
    [act, runId, baselineId, retire],
  );

  const seek = useCallback(
    (to: number) =>
      act(async () => {
        if (!runId) return;
        await Promise.all([
          api.controlRun(runId, { action: 'seek', t: to }),
          baselineId ? api.controlRun(baselineId, { action: 'seek', t: to }) : Promise.resolve(null),
        ]);
      }),
    [act, runId, baselineId],
  );

  // --- the story ----------------------------------------------------------------

  const startStory = useCallback(() => {
    narrator.stop();
    setScenarioId(STORY_SCENARIO);
    setPolicyId(STORY_POLICY);
    setCompare(true);
    setSeed(STORY_SEED);
    setView('story');
    setStoryPaused(false);
    setSkippingFrom(null);
    setPinned(false);
    setStoryTake((take) => take + 1);
    // On the public build the selection is the recording; the effect below
    // winds it back to the start. Locally the two runs are started fresh.
    if (!IS_PUBLIC_PREVIEW) {
      void startWith({ scenario: STORY_SCENARIO, policy: STORY_POLICY, seed: STORY_SEED, compare: true });
    }
  }, [startWith]);

  useEffect(() => {
    if (!IS_PUBLIC_PREVIEW || view !== 'story' || !runId) return;
    const ids = [runId, baselineId].filter((id): id is string => Boolean(id));
    void Promise.all(
      ids.map(async (id) => {
        await api.controlRun(id, { action: 'reset' });
        await api.controlRun(id, { action: 'play', speed: 1 });
      }),
    ).catch(() => undefined);
  }, [view, runId, baselineId, storyTake]);

  // `?story` opens straight into the film - the link to send someone. The film
  // is a file, so unlike the 3D replay it does not wait for the runs to load.
  useEffect(() => {
    if (typeof window === 'undefined' || !new URLSearchParams(window.location.search).has('story')) return undefined;
    // Opened from a timer, once: the effect only notices that it is time.
    const timer = setTimeout(() => {
      window.history.replaceState(null, '', window.location.pathname);
      setFilmOpen(true);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  // The 3D replay of the story needs its two runs: recorded, or an engine to run them.
  const canReplay3D = IS_PUBLIC_PREVIEW ? demoRuns.length > 0 : scenarios.some((entry) => entry.id === STORY_SCENARIO);
  const closeFilm = useCallback(() => setFilmOpen(false), []);

  /**
   * The one way in: the run that shows what CONTINUA is for - the shadowed
   * route, CONTINUA with its road map beside the normal rover - started at
   * once. The dock changes it from there.
   */
  const startDrive = useCallback(() => {
    narrator.stop();
    setView('drive');
    setCamera('follow');
    setScenarioId(STORY_SCENARIO);
    setPolicyId(STORY_POLICY);
    setSeed(STORY_SEED);
    setCompare(true);
    setPinned(false);
    // On the public build the selection is the recording, and it plays itself.
    if (!IS_PUBLIC_PREVIEW && scenarios.some((entry) => entry.id === STORY_SCENARIO)) {
      void startWith({ scenario: STORY_SCENARIO, policy: STORY_POLICY, seed: STORY_SEED, compare: true });
    }
  }, [startWith, scenarios]);

  const exitStory = useCallback(() => {
    setView('drive');
    setCamera('follow');
    setStoryPaused(false);
    setSkippingFrom(null);
    if (runId && run.state?.status !== 'completed') void control('play', { speed: 1 });
  }, [runId, run.state?.status, control]);

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
  const showSummary =
    view === 'drive' && summary !== null && summary.runId === runId && completed && summaryClosedFor !== runId;

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

  const scenario = useMemo(
    () => scenarios.find((s) => s.id === (run.state?.scenario_id ?? scenarioId)),
    [scenarios, run.state?.scenario_id, scenarioId],
  );

  // Where this scenario shadows the links: the scene stands walls there.
  const deadZones = useMemo(() => deadZonesFromFaults(scenario?.faults), [scenario]);
  // A reversed scenario drives the route from its far end; the recorded
  // distances are distances travelled, so the scene has to be told.
  const reverse = Boolean(scenario?.reverse);
  useEffect(() => {
    run.source.setReverse(reverse);
    baseline.source.setReverse(reverse);
  }, [run.source, baseline.source, reverse]);

  // --- the rover under the viewer's keys --------------------------------------------
  // Taking the wheel holds the recording; the camera goes behind the rover.
  const onTakeWheel = useCallback(() => {
    setCamera('drive');
    setSettingsOpen(false);
    setPinned(false);
    narrator.say(spokenLines.tookWheel, { kind: 'announcement' });
    if (runId) {
      const ids = [runId, baselineId].filter((id): id is string => Boolean(id));
      void Promise.all(ids.map((id) => api.controlRun(id, { action: 'pause' }))).catch(() => undefined);
    }
  }, [runId, baselineId]);
  // Handing back plays the recording on from the rover's point of the road.
  // On the public build that is the recording itself; locally the drive had
  // the engine finish the run, so a replay of it - badged as one - plays on.
  const onReleaseWheel = useCallback(
    (at: number) => {
      setCamera('follow');
      narrator.say(spokenLines.handedBack, { kind: 'announcement' });
      if (!runId) return;
      void act(async () => {
        const ids = [runId, baselineId].filter((id): id is string => Boolean(id));
        if (IS_PUBLIC_PREVIEW) {
          await Promise.all(
            ids.map(async (id) => {
              await api.controlRun(id, { action: 'seek', t: at });
              await api.controlRun(id, { action: 'play', speed: 1 });
            }),
          );
          return;
        }
        const recordingOf = (id: string, state: EngineRunState | null) => (state?.mode === 'replay' ? (state.source?.run_id ?? id) : id);
        const [response, baselineResponse] = await Promise.all([
          api.replay(recordingOf(runId, run.state)),
          baselineId ? api.replay(recordingOf(baselineId, baseline.state)) : Promise.resolve(null),
        ]);
        setStartedRunId(response.run_id);
        setStartedBaselineId(baselineResponse?.run_id ?? null);
        retire([runId, baselineId], [response.run_id, baselineResponse?.run_id ?? null]);
        const replays = [response.run_id, baselineResponse?.run_id].filter((id): id is string => Boolean(id));
        await Promise.all(replays.map((id) => api.controlRun(id, { action: 'seek', t: at })));
      });
    },
    [runId, baselineId, act, retire, run.state, baseline.state],
  );
  const drive = useDrive({
    enabled: view === 'drive' && Boolean(runId),
    runId,
    runState: run.state,
    baselineId,
    baselineState: baseline.state,
    reverse,
    onTake: onTakeWheel,
    onRelease: onReleaseWheel,
  });
  const driving = drive.session !== null;
  const driveFeed = driving ? drive.feed : null;

  // --- what the panels read: the run as it streams, or, while driving, the
  // recording at the rover's point of the road ----------------------------------------
  const latest = driveFeed ? driveFeed.latest : run.latest;
  const decisions = driveFeed ? driveFeed.decisions : run.decisions;
  const history = driveFeed ? driveFeed.history : run.history;
  const mainSource = drive.session ? drive.session.main.source : run.source;

  // The baseline as it was at this run's moment - its own buffer, read at this
  // run's time, so the two are compared at the same point of the route.
  const streamedBaseline = useMemo(
    () => (baselineId && run.latest ? baseline.source.eventAt(run.latest.t) : null),
    // `baseline.latest` changes whenever the baseline's buffer grows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [baselineId, baseline.source, baseline.latest, run.latest],
  );
  const baselineEvent = driveFeed ? driveFeed.baseline : streamedBaseline;
  const baselineSource = drive.session?.baseline ? drive.session.baseline.source : baseline.source;
  // Each run's whole timeline for the dock's tracks; `latest` changes as it grows.
  const runTrack = useMemo(
    () =>
      drive.session
        ? { events: drive.session.main.events, version: -1 }
        : runId
          ? { events: run.source.timeline, version: run.latest?.seq ?? 0 }
          : null,
    [drive.session, runId, run.source, run.latest],
  );
  const baselineTrack = useMemo(
    () =>
      drive.session?.baseline
        ? { events: drive.session.baseline.events, version: -1 }
        : baselineId
          ? { events: baseline.source.timeline, version: baseline.latest?.seq ?? 0 }
          : null,
    [drive.session, baselineId, baseline.source, baseline.latest],
  );

  // Follow the carrying link unless the operator has pinned one. Derived during
  // render rather than synchronised from an effect.
  const carrying = latest?.carrying ?? null;
  const activeLink: EngineLinkId = pinned ? selectedLink : (carrying ?? selectedLink);

  const story = useStoryDirector({
    active: view === 'story' && Boolean(runId),
    main: run.latest,
    mainTimeline: run.source.timeline,
    baseline: baselineEvent,
    baselineTimeline: baseline.source.timeline,
    completed,
    zones: deadZones,
    reverse,
  });
  // "Next chapter" hurries the run along until the chapter changes.
  const skipping = skippingFrom !== null && skippingFrom === story.beat;
  const storySpeed = skipping ? 8 : story.speed;

  // The story sets the pace: slow while a caption is read, quicker between.
  useEffect(() => {
    if (view !== 'story' || storyPaused || !runId || completed) return;
    const ids = [runId, baselineId].filter((id): id is string => Boolean(id));
    void Promise.all(ids.map((id) => api.controlRun(id, { action: 'speed', speed: storySpeed }))).catch(() => undefined);
  }, [view, storyPaused, runId, baselineId, storySpeed, completed]);

  const toggleStory = useCallback(() => {
    if (storyPaused) {
      setStoryPaused(false);
      void control('play', { speed: storySpeed });
    } else {
      setStoryPaused(true);
      void control('pause');
    }
  }, [storyPaused, control, storySpeed]);

  // --- what the panels read ------------------------------------------------------

  const duration = run.state?.duration_s ?? scenario?.duration_s ?? 100;
  const t = driving ? drive.t : (run.state?.t ?? 0);
  const controlMode = controlModeOf(latest);
  const zone = latest?.vehicle?.zone ? (ZONE_LABEL[latest.vehicle.zone] ?? latest.vehicle.zone) : null;
  const handoff = useMemo(() => recentHandoff(decisions, latest), [decisions, latest]);
  const runPolicy = (run.state?.policy_id ?? policyId) as PolicyIdString;

  // The road strip: the policy's road map, the rover on it, and its horizon.
  const radioMap = useRadioMap(runId || view !== 'landing' ? (scenario?.radio_map ?? 'baseline-journey') : null);
  const travelled = latest?.vehicle?.distance_m ?? null;
  const position =
    driving && drive.readout ? drive.readout.along : travelled === null ? null : reverse ? route.length - travelled : travelled;
  const preparedAt = useMemo(() => {
    for (let i = decisions.length - 1; i >= 0; i -= 1) {
      if (/^Preparing /.test(decisions[i]!.reason ?? '')) return decisions[i]!.t;
    }
    return null;
  }, [decisions]);
  const preparing =
    preparedAt !== null &&
    latest !== null &&
    latest.t - preparedAt < 10 &&
    latest.carrying !== 'satellite';
  // When the road map's warning started a network: what the voice announces,
  // once - the decisions after it give the same reason for what they hold back.
  const warnedAt = useMemo(() => {
    for (let i = decisions.length - 1; i >= 0; i -= 1) {
      const event = decisions[i]!;
      if (/^Preparing /.test(event.reason ?? '') && actionsOf(event).some((action) => action.kind === 'activate_backup')) return event.t;
    }
    return null;
  }, [decisions]);
  // The road map's warning while it stands: from the decision that started a
  // network for a known gap until that network carries the link, or a few
  // seconds pass.
  const warning = useMemo(() => {
    const now = latest;
    if (!now) return null;
    for (let i = decisions.length - 1; i >= 0; i -= 1) {
      const event = decisions[i]!;
      if (event.t > now.t + 0.05) continue;
      if (now.t - event.t > WARNING_VISIBLE_S) return null;
      const words = warningWords(event);
      if (words) return now.carrying === words.link ? null : { event, words };
    }
    return null;
  }, [decisions, latest]);
  // The one thing that just happened, for the banner: the more recent of the
  // warning and the last change of network. Whether the new network was
  // already up is its recorded phase just before the switch; where the new
  // link comes from is the site of that network nearest the rover.
  const moment = useMemo((): MomentSpec | null => {
    if (view !== 'drive') return null;
    if (warning && (!handoff || warning.event.t > handoff.at)) {
      return { kind: 'warning', key: `w${warning.event.seq}`, at: warning.event.t, ...warning.words };
    }
    if (!handoff) return null;
    const why = handoffWhy(handoff.event, handoff.from);
    const ready = mainSource.eventAt(handoff.at - 0.05)?.links[handoff.to]?.phase === 'active';
    const along = handoff.event.vehicle ? (reverse ? route.length - handoff.event.vehicle.distance_m : handoff.event.vehicle.distance_m) : null;
    const where = along === null ? null : linkSource(handoff.to, along);
    const detail = [where, why, ready ? `${NETWORK[handoff.to].name} was already up` : null].filter(Boolean).join(' · ');
    return { kind: 'handoff', key: `h${handoff.seq}`, at: handoff.at, from: handoff.from, to: handoff.to, detail: detail || null };
  }, [view, warning, handoff, mainSource, reverse]);
  // While driving, a moment holds for a few seconds of the viewer's time, not
  // the recording's: a rover stopped just past a change would hold it forever.
  const momentShown = useHeldFor(driving ? (moment?.key ?? null) : null, HANDOFF_VISIBLE_S * 1000);
  const shownMoment = driving && !momentShown ? null : moment;

  const roadAhead = (
    <RoadAhead
      map={radioMap}
      position={position}
      direction={reverse ? -1 : 1}
      speedMps={driving && drive.readout ? drive.readout.speedKmh / 3.6 : (latest?.vehicle?.speed_mps ?? 0)}
      lookahead={runPolicy === 'P3'}
      preparing={preparing}
      deadZones={deadZones}
      compact
    />
  );
  // When the rover was in each cutting, from its own distances, for the timeline.
  const deadZoneTimes = useMemo(() => {
    if (deadZones.length === 0 || !runTrack) return [];
    const spans: { from: number; to: number }[] = [];
    for (const deadZone of deadZones) {
      const lo = deadZone.from - deadZone.ramp / 2;
      const hi = deadZone.to + deadZone.ramp / 2;
      let from: number | null = null;
      let to: number | null = null;
      for (const event of runTrack.events) {
        const d = event.vehicle?.distance_m;
        if (d === undefined) continue;
        const along = reverse ? route.length - d : d;
        if (along >= lo && along <= hi) {
          from ??= event.t;
          to = event.t;
        }
      }
      if (from !== null && to !== null) spans.push({ from, to });
    }
    return spans;
  }, [deadZones, runTrack, reverse]);

  const mainName = STRATEGY[runPolicy]?.who ?? runPolicy;
  const landing = view === 'landing' && !runId;
  // The run the page opens on - the shadowed route, CONTINUA with its road map
  // beside the normal rover - has a stored twenty-drive comparison; its
  // summary says what that found.
  const featuredRun = (run.state?.scenario_id ?? scenarioId) === STORY_SCENARIO && runPolicy === STORY_POLICY && Boolean(baselineId);
  // The run's end card waits while the viewer drives: locally, taking the
  // wheel has the engine finish the run, and that is not the end of the drive.
  const summaryShown = showSummary && !driving;
  const { rows: proofRows } = useProofRows(summaryShown && featuredRun);
  // The road strip says something only where there is a cutting to point at
  // or a road map steering the run; elsewhere it was one more band of text.
  const showRoad = deadZones.length > 0 || runPolicy === 'P3';

  // How much of the stage the panels cover, top and bottom, so the cameras
  // centre the rover in what is left. Framed for the whole canvas, it sat
  // behind the dock on a laptop screen. Measured, not assumed: the dock's
  // height depends on the view, the run and the screen.
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [inset, setInset] = useState({ top: 0, bottom: 0 });
  const storyBar = view === 'story' && Boolean(runId) && !story.finished;
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const observer = new ResizeObserver(() => {
      const box = stage.getBoundingClientRect();
      const top = topRef.current ? Math.max(0, topRef.current.getBoundingClientRect().bottom - box.top) : 0;
      const bottom = bottomRef.current ? Math.max(0, box.bottom - bottomRef.current.getBoundingClientRect().top) : 0;
      setInset((previous) =>
        Math.abs(previous.top - top) < 2 && Math.abs(previous.bottom - bottom) < 2
          ? previous
          : { top: Math.round(top), bottom: Math.round(bottom) },
      );
    });
    observer.observe(stage);
    if (topRef.current) observer.observe(topRef.current);
    if (bottomRef.current) observer.observe(bottomRef.current);
    return () => observer.disconnect();
  }, [view, runId, storyBar, showRoad, detail]);

  // The bar steps aside after a few seconds with nothing touched, while a run
  // plays; the picture is the point. Moving over the scene, or any key, brings
  // it back at once - except the keys that drive, while driving.
  const drivingRef = useRef(false);
  useEffect(() => {
    drivingRef.current = driving;
  }, [driving]);
  useEffect(() => {
    if (view !== 'drive') return undefined;
    const stage = stageRef.current;
    let timer = setTimeout(() => setBarIdle(true), BAR_IDLE_MS);
    const wake = (event?: Event) => {
      if (drivingRef.current && event instanceof KeyboardEvent && /^(Key[WASD]|Arrow|Space)/.test(event.code)) return;
      setBarIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setBarIdle(true), BAR_IDLE_MS);
    };
    stage?.addEventListener('pointermove', wake);
    stage?.addEventListener('pointerdown', wake);
    window.addEventListener('keydown', wake);
    return () => {
      clearTimeout(timer);
      stage?.removeEventListener('pointermove', wake);
      stage?.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
    };
  }, [view]);

  // --- the story's voice ------------------------------------------------------
  // Each caption is read aloud once it has held for a moment: as the facts
  // arrive a caption can be rewritten twice in a second, and the voice should
  // read the settled one, not each draft.
  const voice = useNarrator();
  const captionText = storyBar ? (story.caption?.text ?? null) : null;
  useEffect(() => {
    narrator.showing(captionText);
  }, [captionText]);
  useEffect(() => {
    if (!captionText) return undefined;
    const timer = setTimeout(() => narrator.say(captionText), 450);
    return () => clearTimeout(timer);
  }, [captionText]);
  useEffect(() => {
    if (storyPaused) narrator.pause();
    else narrator.resume();
  }, [storyPaused]);
  // Silent outside the story, and when the page goes.
  useEffect(() => {
    if (view !== 'story') narrator.stop();
  }, [view]);
  useEffect(() => () => narrator.stop(), []);
  const narrateProof = useCallback(
    (text: string) => {
      if (view !== 'story') return;
      narrator.showing(text);
      narrator.say(text);
    },
    [view],
  );

  // Driving, the voice says what changed, in the short words on screen: the
  // toast when the network changes, the road strip's warning, and a status
  // card when either rover loses or gets back its connection - once that has
  // held for a second, so the session's first fifth of a second and other
  // blips stay silent. Long sentences fell behind when changes came close
  // together; the reasons are in the dock's last decision, to read.
  const handoffKey = view === 'drive' && handoff ? `${runId}:${handoff.seq}` : null;
  const handoffLine = handoff ? spokenLines.movedTo(handoff.to) : null;
  // Driving back and forth over a change says it the first time only.
  const saidWhileDriving = useRef(new Set<string>());
  useEffect(() => {
    if (!driving) saidWhileDriving.current.clear();
  }, [driving]);
  useEffect(() => {
    if (!handoffKey || !handoffLine) return undefined;
    if (driving) {
      if (saidWhileDriving.current.has(handoffKey)) return undefined;
      saidWhileDriving.current.add(handoffKey);
    }
    const timer = setTimeout(() => narrator.say(handoffLine, { kind: 'announcement' }), 250);
    return () => clearTimeout(timer);
    // Keyed on the handoff, not its words: the same move can come twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoffKey]);
  const warningKey = view === 'drive' && preparing && warnedAt !== null ? `${runId}:${warnedAt}` : null;
  useEffect(() => {
    if (!warningKey) return undefined;
    const timer = setTimeout(() => narrator.say(spokenLines.gapAhead, { kind: 'announcement' }), 250);
    return () => clearTimeout(timer);
  }, [warningKey]);
  const mainUp = view === 'drive' && runId ? connectionState(latest).up : null;
  const baseUp = view === 'drive' && baselineId ? connectionState(baselineEvent).up : null;
  const heardUp = useRef<{ run: string | null; main: boolean | null; base: boolean | null }>({ run: null, main: null, base: null });
  useEffect(() => {
    if (mainUp === null && baseUp === null) return undefined;
    const timer = setTimeout(() => {
      const heard = heardUp.current;
      if (heard.run !== runId) Object.assign(heard, { run: runId, main: null, base: null });
      const say = (name: string, previous: boolean | null, now: boolean | null) => {
        if (previous === null || now === null || previous === now) return;
        if (now) narrator.say(spokenLines.connection(name, true), { kind: 'announcement', cancels: spokenLines.connection(name, false) });
        else narrator.say(spokenLines.connection(name, false), { kind: 'announcement' });
      };
      say(mainName, heard.main, mainUp);
      say('Normal rover', heard.base, baseUp);
      if (mainUp !== null) heard.main = mainUp;
      if (baseUp !== null) heard.base = baseUp;
    }, 1000);
    return () => clearTimeout(timer);
  }, [mainUp, baseUp, runId, mainName]);

  return (
    <AppShell
      variant="immersive"
      bar={
        <RunStatusBar
          state={run.state}
          connection={run.connection}
          // Driving, nothing streams: the whole recording is already here.
          stale={run.stale && !driving}
          dropped={run.droppedSequences}
          actions={
            driving ? (
              <Chip tone="blue" title="You are driving the rover. Every network figure on screen is the recorded run at the rover's point of the road.">
                <SteeringIcon size={13} /> DRIVING
              </Chip>
            ) : undefined
          }
        />
      }
    >
      <div
        ref={stageRef}
        className="mission-root absolute inset-0 overflow-hidden bg-[color:var(--color-bg)]"
        data-view={landing ? 'landing' : view}
        // The side columns stop where the dock begins, whatever its height.
        style={inset.bottom > 0 && !landing ? { ['--dock-h' as string]: `calc(${inset.bottom}px - var(--edge))` } : undefined}
      >
        <MissionScene
          source={run.source}
          driven={drive.session?.source ?? null}
          t={t}
          duration={duration}
          playing={playing && !run.stale}
          className="scene-shell-bleed absolute inset-0 h-full w-full"
          preview={!runId}
          camera={view === 'story' && runId ? 'story' : driving ? (camera === 'follow' ? 'drive' : camera) : camera === 'drive' ? 'follow' : camera}
          storyShot={story.shot}
          speed={run.state?.speed ?? 1}
          deadZones={deadZones}
          inset={landing ? undefined : inset}
          still={landing}
          flights={flights && view !== 'story'}
          coverage={coverage && view === 'drive'}
        />

        {/* --- top centre: can each operator reach their rover? --------------- */}
        {/* The run's ending says how it went; the live status steps aside for it. */}
        <div
          className="pointer-events-none absolute top-3 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-2 transition-opacity duration-300"
          style={summaryShown ? { opacity: 0 } : undefined}
        >
          <div ref={topRef} className="flex flex-col items-center gap-2">
          {landing ? null : !runId ? (
            <div className="flex items-center gap-2">
              <span
                className="hud-chip text-[color:var(--color-warn)]"
                title="No run yet: the scene plays the deterministic Phase 1 preview. Nothing on screen is a measurement."
              >
                <span className="h-2 w-2 rounded-full" style={{ background: 'var(--color-warn)' }} />
                SCENE PREVIEW
              </span>
              {zone && <span className="hud-chip text-[color:var(--color-muted)]">{zone}</span>}
            </div>
          ) : (
            <RoverStatus
              main={latest}
              mainName={mainName}
              mainTimeline={mainSource.timeline}
              baseline={baselineId ? baselineEvent : undefined}
              baselineTimeline={baselineId ? baselineSource.timeline : undefined}
              totals={view === 'drive' && detail}
            />
          )}
          {runId && latest && view === 'drive' && detail && (
            <div className="flex items-center gap-2">
              <span
                className="hud-chip"
                style={{
                  color: controlMode === 'teleop' ? 'var(--color-good)' : controlMode === 'waypoint' ? 'var(--color-warn)' : 'var(--color-bad)',
                }}
                title="Operating mode of the control class, chosen by the controller from receiver-side measurements. Policies without mode handover stay in teleop."
              >
                {CONTROL_MODE_LABEL[controlMode].toUpperCase()}
              </span>
              {carrying && (
                <span className="hud-chip" style={{ color: NETWORK_COLOR[carrying] }}>
                  <NetworkIcon link={carrying} size={14} />
                  {LINK_LABEL[carrying].label} carrying
                </span>
              )}
            </div>
          )}
          </div>

          {/* What just happened, said once - the story says it in its caption. */}
          {shownMoment && (
            <Moment moment={shownMoment} holdSeconds={shownMoment.kind === 'warning' ? WARNING_VISIBLE_S : HANDOFF_VISIBLE_S} />
          )}
        </div>

        {/* --- bottom left: take the wheel, or the driver's card ----------------------- */}
        {view === 'drive' && runId && latest && !summaryShown && (
          <DriveHud
            driving={driving}
            preparing={drive.preparing}
            error={drive.error}
            readout={drive.readout}
            runId={run.state?.source?.run_id ?? runId}
            onTake={() => void drive.take()}
            onRelease={drive.release}
          />
        )}

        {/* --- the landing: what this is, and the one way in ------------------------- */}
        {landing && (
          <div className={`absolute inset-x-0 z-10 flex justify-center px-3 ${bootError ? 'top-[30%]' : 'top-[14%]'}`}>
            <StoryLanding onDrive={startDrive} onWatch={() => setFilmOpen(true)} busy={busy} />
          </div>
        )}

        {filmOpen && (
          <StoryFilm
            onClose={closeFilm}
            canReplay3D={canReplay3D}
            onReplay3D={() => {
              setFilmOpen(false);
              startStory();
            }}
            onDrive={() => {
              setFilmOpen(false);
              startDrive();
            }}
          />
        )}

        {view === 'story' && !runId && !bootError && (
          <div className="absolute inset-x-0 top-[40%] z-10 flex justify-center" role="status">
            <span className="hud-chip loading-sweep relative overflow-hidden px-4 text-[13px]">Starting the two rovers…</span>
          </div>
        )}

        {/* --- the story's end: the same road, twenty times --------------------------- */}
        {view === 'story' && story.finished && (
          <div className="absolute inset-x-0 top-[112px] bottom-[var(--edge)] z-20 flex items-start justify-center px-3 max-[800px]:top-[96px]">
            <StoryProof onReplay={startStory} onDrive={exitStory} onNarrate={narrateProof} />
          </div>
        )}

        {summaryShown && summary && runId && (
          <RunSummary
            baseline={baselineMetrics ? { metrics: baselineMetrics, policy: BASELINE_POLICY } : null}
            metrics={summary.metrics}
            title={scenario?.title ?? run.state?.scenario_id ?? scenarioId}
            policy={run.state?.policy_id ?? policyId}
            seed={run.state?.seed ?? null}
            simple={!detail}
            mainName={mainName}
            proof={featuredRun ? proofSentence(proofRows) : null}
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

        {/* --- left: the networks, or (in the story) what CONTINUA decided ------------ */}
        {view === 'drive' && (
          <aside className="mission-side mission-left scroll-y enter">
            <LinkStack
              event={latest}
              history={history}
              selected={activeLink}
              simple={!detail}
              title={`${mainName}'s networks`}
              onSelect={(link) => {
                setSelectedLink(link);
                setPinned(true);
              }}
            />
            {pinned && detail && (
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
        )}

        {/* --- right: the two rovers head to head; Details adds the measurements ------- */}
        {/* Nothing here before a run: the totals and the cameras enter with its
            first event, rather than as empty gauges and "no stream". */}
        {(view === 'drive' || (view === 'story' && runId && !story.finished)) && latest && (
          <aside className="mission-side mission-right scroll-y enter-late flex flex-col gap-3 *:shrink-0">
            <HeadToHead
              main={latest}
              baseline={baselineId ? baselineEvent : undefined}
              mainName={mainName}
              camera={
                detail && view === 'drive' ? undefined : (
                  <CameraFeed
                    event={latest}
                    baseline={baselineId ? baselineEvent : undefined}
                    baselineLabel="Normal rover"
                    mainLabel={mainName}
                    compact
                    bare
                  />
                )
              }
            />
            {view === 'drive' && detail && (
              <>
                <div className="enter">
                  <ApplicationPanel event={latest} />
                </div>
                <div className="enter-late">
                  <CameraFeed
                    event={latest}
                    baseline={baselineId ? baselineEvent : undefined}
                    baselineLabel="Normal rover"
                    mainLabel={mainName}
                    defaultOpen={false}
                  />
                </div>
                <RouteMap event={latest} events={decisions} reverse={reverse} />
              </>
            )}
          </aside>
        )}

        {/* --- bottom: the story's bar, or the run's dock --------------------------------- */}
        {storyBar && (
          <div className="mission-dock" ref={bottomRef}>
            <StoryBar
              caption={story.caption}
              chapter={story.caption?.chapter ?? 1}
              paused={storyPaused}
              speed={storySpeed}
              voice={{
                on: !voice.muted,
                blocked: voice.blocked,
                onToggle: () => narrator.setMuted(!voice.muted),
                onUnblock: () => narrator.unblock(),
              }}
              onToggle={toggleStory}
              onNext={() => {
                // The next chapter's caption is read at once, not after this one.
                narrator.stop();
                setSkippingFrom(story.beat);
              }}
              onExit={exitStory}
            />
          </div>
        )}
        {view === 'drive' && (
          <div
            className="mission-dock"
            ref={bottomRef}
            data-idle={barIdle && !barHeld && playing && !settingsOpen && !detail}
            onPointerEnter={() => setBarHeld(true)}
            onPointerLeave={() => setBarHeld(false)}
            onFocusCapture={() => setBarHeld(true)}
            onBlurCapture={() => setBarHeld(false)}
          >
            <span aria-hidden className="mission-dock-peek" style={{ transform: `scaleX(${duration > 0 ? Math.min(1, t / duration) : 0})` }} />
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
              latest={latest}
              decisions={decisions}
              history={history}
              onStart={start}
              onToggle={() => (driving ? drive.release() : control(playing ? 'pause' : 'play'))}
              onReset={() => (driving ? drive.session?.source.placeAt(0) : control('reset'))}
              onReplay={replay}
              onSpeed={(speed) => control('speed', { speed })}
              // While driving, a moment on the timeline puts the rover where the recording had it then.
              onSeek={(to) => (driving ? drive.session?.source.placeAt(to) : seek(to))}
              driving={driving}
              compare={comparing}
              onCompare={setCompare}
              track={runTrack}
              baseline={baselineTrack}
              simple={!detail}
              detail={detail}
              onDetail={setDetail}
              roadAhead={showRoad ? roadAhead : undefined}
              deadZoneTimes={deadZoneTimes}
              settingsOpen={settingsOpen}
              onSettings={setSettingsOpen}
              extra={
                <>
                  <VoiceSwitch
                    on={!voice.muted}
                    blocked={voice.blocked}
                    onToggle={() => narrator.setMuted(!voice.muted)}
                    onUnblock={() => narrator.unblock()}
                  />
                  <CameraSwitch value={driving && camera === 'follow' ? 'drive' : camera} onChange={setCamera} driving={driving} />
                  <SceneToggle
                    on={flights}
                    onToggle={() => setFlights((value) => !value)}
                    Icon={FlightIcon}
                    label={flights ? 'Camera flies to each new link' : 'Camera stays with the rover'}
                    title={
                      flights
                        ? 'On: at each change of network the camera flies out to where the new link comes from - the access point, the mast, the satellite - and back along it to the rover. Click to keep the camera with the rover.'
                        : 'Off: the camera stays with the rover. Click to fly out to each new link.'
                    }
                  />
                  <SceneToggle
                    on={coverage}
                    onToggle={() => setCoverage((value) => !value)}
                    Icon={CoverageIcon}
                    label={coverage ? 'Hide where each network reaches' : 'Show where each network reaches'}
                    title="Where each network reaches, on the ground: the model's coverage of each access point and the mast - not a measurement, and not the link in use."
                  />
                  <FullscreenButton target={stageRef} />
                </>
              }
            />
          </div>
        )}

        {(notice || (run.connection === 'disconnected' && runId)) && (
          <div className="pointer-events-none absolute bottom-[calc(var(--dock-h)+var(--edge)*2+8px)] left-1/2 z-20 -translate-x-1/2" role="status">
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

/** The voice that says what changed: on, off, or waiting for a click the browser asked for. */
function VoiceSwitch({
  on,
  blocked,
  onToggle,
  onUnblock,
}: {
  on: boolean;
  blocked: boolean;
  onToggle: () => void;
  onUnblock: () => void;
}) {
  if (on && blocked) {
    return (
      <button
        type="button"
        className="control story-sound shrink-0"
        onClick={onUnblock}
        title="The browser held the voice back until the page is clicked: click to hear each change said aloud"
      >
        <SpeakerIcon size={15} /> Sound
      </button>
    );
  }
  return (
    <button
      type="button"
      className="icon-btn shrink-0"
      onClick={onToggle}
      aria-pressed={on}
      aria-label={on ? 'Turn the voice off' : 'Say each change aloud'}
      title={on ? 'Voice on: each change of network is said aloud. Click to turn it off.' : 'Voice off. Click to hear each change of network said aloud.'}
      data-active={on}
    >
      {on ? <SpeakerIcon size={16} /> : <SpeakerOffIcon size={16} />}
    </button>
  );
}

const CAMERAS: { id: MissionCamera; label: string; Icon: typeof FollowIcon }[] = [
  { id: 'cinematic', label: 'Cinematic camera', Icon: CinematicIcon },
  { id: 'follow', label: 'Follow camera', Icon: FollowIcon },
  { id: 'overview', label: 'Overview camera', Icon: OverviewIcon },
  { id: 'closeup', label: 'Close-up camera', Icon: CloseupIcon },
];

/** While driving, the follow camera is the one behind the rover as it is steered. */
const DRIVE_CAMERAS: typeof CAMERAS = CAMERAS.map((entry) =>
  entry.id === 'follow' ? { id: 'drive', label: 'Driver camera, behind the rover', Icon: SteeringIcon } : entry,
);

/**
 * Where a new link comes from, in a few words, for the moment banner: the
 * site of that network nearest the rover - the end of the link the scene
 * draws, and the one the camera flies to. Null for satellite, whose far end
 * is the sky.
 */
function linkSource(link: EngineLinkId, along: number): string | null {
  if (link === 'satellite') return null;
  if (link === 'wired') return 'From the dock';
  const at = route.at(along);
  let best: (typeof SITES)[number] | null = null;
  let bestDistance = Infinity;
  for (const site of SITES) {
    if (site.network !== link) continue;
    const distance = Math.hypot(site.x - at.x, site.z - at.z);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = site;
    }
  }
  if (!best) return null;
  return link === 'wifi' ? `From ${best.label.replace(/^Wi-Fi /, '')}` : 'From the cell mast';
}

/** True while `key` has been the same for less than `ms` - a moment shown for a while of the viewer's time. */
function useHeldFor(key: string | null, ms: number): boolean {
  const [expired, setExpired] = useState<string | null>(null);
  useEffect(() => {
    if (!key) return undefined;
    const timer = setTimeout(() => setExpired(key), ms);
    return () => clearTimeout(timer);
  }, [key, ms]);
  return key !== null && expired !== key;
}

/** One of the scene's switches in the bar: an icon that is on or off. */
function SceneToggle({
  on,
  onToggle,
  Icon,
  label,
  title,
}: {
  on: boolean;
  onToggle: () => void;
  Icon: typeof FollowIcon;
  label: string;
  title: string;
}) {
  return (
    <button type="button" className="icon-btn shrink-0" onClick={onToggle} aria-pressed={on} aria-label={label} title={title} data-active={on}>
      <Icon size={16} />
    </button>
  );
}

/** Four viewpoints on the same run. A camera changes the picture, never the data. */
function CameraSwitch({
  value,
  onChange,
  driving = false,
}: {
  value: MissionCamera;
  onChange: (camera: MissionCamera) => void;
  driving?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label="Camera"
      className="pointer-events-auto flex shrink-0 items-center gap-0.5 rounded-[11px] border border-[color:var(--color-line)] bg-[color:var(--color-surface)] p-[2px]"
    >
      {(driving ? DRIVE_CAMERAS : CAMERAS).map(({ id, label, Icon }) => (
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
