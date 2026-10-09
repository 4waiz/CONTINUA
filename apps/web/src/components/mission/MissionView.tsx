'use client';

/**
 * The Mission page - the flagship view.
 *
 * * **Landing.** What this is, in two sentences, over a still island; one way
 *   in. Nothing moves until it is pressed.
 * * **Drive.** The run that shows what CONTINUA is for - the shadowed route,
 *   CONTINUA with its road map beside the normal rover - starts at once, and
 *   is then yours to change and scrub: in plain words by default, every
 *   measurement one toggle away (Details). Each change of network is shown -
 *   the camera flies out to where the new link comes from and back along it
 *   to the rover - and said aloud.
 * * **The story** (`?story` only, the link to send someone). The same run as
 *   a guided minute (`story.tsx`): captions read aloud, the framing chosen for
 *   each chapter, and the stored twenty-trial comparison at the end.
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
} from '../ui/icons';
import { ApplicationPanel } from './ApplicationPanel';
import { CameraFeed } from './CameraFeed';
import { FullscreenButton } from './FullscreenButton';
import { HeadToHead } from './HeadToHead';
import { LinkStack } from './LinkStack';
import { MissionDock } from './MissionDock';
import { MissionScene, type MissionCamera } from './MissionScene';
import { Moment, type MomentSpec } from './Moment';
import { driveCommentary } from './commentary';
import { handoffWhy, NETWORK, STRATEGY, warningWords } from './plain';
import { RoadAhead, useRadioMap } from './RoadAhead';
import { RouteMap } from './RouteMap';
import { RoverStatus } from './RoverStatus';
import { RunSummary } from './RunSummary';
import { StoryBar, STORY_POLICY, STORY_SCENARIO, useStoryDirector } from './story';
import { proofSentence, StoryLanding, StoryProof, useProofRows } from './StoryCards';
import { narrator, useNarrator } from './voice';
import { Tour } from '../onboarding/Tour';
import { DRIVE_TOUR } from '../onboarding/tours';
import { tourLinked, usePageTour } from '../onboarding/usePageTour';

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

/**
 * Where the first drive is held while its tour is open: just after the start.
 * At 0 s the rovers' cables are not yet up, and both read "Connection lost"
 * while the tour says what green and red mean.
 */
const TOUR_HOLD_S = 0.5;

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

/** Where the run starts: `?drive` opens the controls. (`?story` starts the story - see below.) */
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

  // `?story` opens straight into it - the link to send someone.
  const storyLinkHandled = useRef(false);
  useEffect(() => {
    if (storyLinkHandled.current) return undefined;
    if (typeof window === 'undefined' || !new URLSearchParams(window.location.search).has('story')) return undefined;
    if (!IS_PUBLIC_PREVIEW && scenarios.length === 0) return undefined;
    if (IS_PUBLIC_PREVIEW && demoRuns.length === 0) return undefined;
    // Started from a timer, once: the effect only notices that it is time.
    const timer = setTimeout(() => {
      if (storyLinkHandled.current) return;
      storyLinkHandled.current = true;
      window.history.replaceState(null, '', window.location.pathname);
      startStory();
    }, 0);
    return () => clearTimeout(timer);
  }, [scenarios.length, demoRuns.length, startStory]);

  // --- the tour of the drive -------------------------------------------------
  // The first drive from the landing opens on a short tour of the screen, the
  // drive held at its start until the tour is done or skipped; the top bar's
  // Guide opens it again whenever the drive is on screen, holding it where it
  // is. Never in the story, which says what is happening itself. `?tour` in
  // the address asks for it on the first drive whatever this browser
  // remembers - opened here, at the hold, not by the link's own timer.
  const tourOnDrive = useRef(false);
  const tourAsked = useRef<boolean | null>(null);
  const tourFromStart = useRef(false);
  const tourResume = useRef(false);
  const [tourFinish, setTourFinish] = useState('Start the drive');
  const driveTour = usePageTour('mission-drive', {
    enabled: view === 'drive',
    fromLink: false,
    onOpen: () => {
      narrator.stop();
      tourResume.current = playing || tourFromStart.current;
      setTourFinish(tourFromStart.current ? 'Start the drive' : 'Back to the drive');
      void control('pause');
      if (tourFromStart.current) void seek(TOUR_HOLD_S);
      tourFromStart.current = false;
    },
    onClose: () => {
      if (tourResume.current) void control('play');
      tourResume.current = false;
    },
  });
  const firstEvent = Boolean(run.latest);
  const { known: tourKnown, open: tourOpen, start: startTour } = driveTour;
  useEffect(() => {
    if (!tourOnDrive.current) return undefined;
    tourAsked.current ??= tourLinked();
    if (tourKnown === true && !tourAsked.current) {
      tourOnDrive.current = false;
      return undefined;
    }
    if (view !== 'drive' || !runId || !firstEvent || tourKnown === null || tourOpen) return undefined;
    // Once the run's first event is in, so the panels the tour points at are there.
    const timer = setTimeout(() => {
      if (!tourOnDrive.current) return;
      tourOnDrive.current = false;
      tourAsked.current = false;
      tourFromStart.current = true;
      startTour();
    }, 450);
    return () => clearTimeout(timer);
  }, [view, runId, firstEvent, tourKnown, tourOpen, startTour]);

  /**
   * The one way in: the run that shows what CONTINUA is for - the shadowed
   * route, CONTINUA with its road map beside the normal rover - started at
   * once. The dock changes it from there.
   */
  const startDrive = useCallback(() => {
    narrator.stop();
    tourOnDrive.current = true;
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

  // Where this scenario shadows the links: the scene stands walls there.
  const deadZones = useMemo(() => deadZonesFromFaults(scenario?.faults), [scenario]);
  // A reversed scenario drives the route from its far end; the recorded
  // distances are distances travelled, so the scene has to be told.
  const reverse = Boolean(scenario?.reverse);
  useEffect(() => {
    run.source.setReverse(reverse);
    baseline.source.setReverse(reverse);
  }, [run.source, baseline.source, reverse]);
  // With the normal rover beside the run, both rovers are drawn, a lane each.
  // Either one is drawn braking to a stand while its own receiver reports its
  // link down, as a remotely driven rover must - the hold in
  // EngineSceneStateSource; where it is drawn is the only thing that changes.
  const twoRovers = Boolean(baselineId);
  useEffect(() => {
    run.source.setHold(true);
    baseline.source.setHold(true);
    run.source.setLane(twoRovers ? 'main' : null);
    baseline.source.setLane('companion');
  }, [run.source, baseline.source, twoRovers]);

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
  const t = run.state?.t ?? 0;
  const controlMode = controlModeOf(run.latest);
  const zone = run.latest?.vehicle?.zone ? (ZONE_LABEL[run.latest.vehicle.zone] ?? run.latest.vehicle.zone) : null;
  const handoff = useMemo(() => recentHandoff(run.decisions, run.latest), [run.decisions, run.latest]);
  const runPolicy = (run.state?.policy_id ?? policyId) as PolicyIdString;

  // The road strip: the policy's road map, the rover on it, and its horizon.
  const radioMap = useRadioMap(runId || view !== 'landing' ? (scenario?.radio_map ?? 'baseline-journey') : null);
  const travelled = run.latest?.vehicle?.distance_m ?? null;
  const position = travelled === null ? null : reverse ? route.length - travelled : travelled;
  const preparedAt = useMemo(() => {
    for (let i = run.decisions.length - 1; i >= 0; i -= 1) {
      if (/^Preparing /.test(run.decisions[i]!.reason ?? '')) return run.decisions[i]!.t;
    }
    return null;
  }, [run.decisions]);
  const preparing =
    preparedAt !== null &&
    run.latest !== null &&
    run.latest.t - preparedAt < 10 &&
    run.latest.carrying !== 'satellite';
  // The road map's warning while it stands: from the decision that started a
  // network for a known gap until that network carries the link, or a few
  // seconds pass.
  const warning = useMemo(() => {
    const now = run.latest;
    if (!now) return null;
    for (let i = run.decisions.length - 1; i >= 0; i -= 1) {
      const event = run.decisions[i]!;
      if (event.t > now.t + 0.05) continue;
      if (now.t - event.t > WARNING_VISIBLE_S) return null;
      const words = warningWords(event);
      if (words) return now.carrying === words.link ? null : { event, words };
    }
    return null;
  }, [run.decisions, run.latest]);
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
    const ready = run.source.eventAt(handoff.at - 0.05)?.links[handoff.to]?.phase === 'active';
    const along = handoff.event.vehicle ? (reverse ? route.length - handoff.event.vehicle.distance_m : handoff.event.vehicle.distance_m) : null;
    const where = along === null ? null : linkSource(handoff.to, along);
    const detail = [where, why, ready ? `${NETWORK[handoff.to].name} was already up` : null].filter(Boolean).join(' · ');
    return { kind: 'handoff', key: `h${handoff.seq}`, at: handoff.at, from: handoff.from, to: handoff.to, detail: detail || null };
  }, [view, warning, handoff, run.source, reverse]);

  const roadAhead = (
    <RoadAhead
      map={radioMap}
      position={position}
      direction={reverse ? -1 : 1}
      speedMps={run.latest?.vehicle?.speed_mps ?? 0}
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
  const { rows: proofRows } = useProofRows(showSummary && featuredRun);
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
  // it back at once.
  useEffect(() => {
    if (view !== 'drive') return undefined;
    const stage = stageRef.current;
    let timer = setTimeout(() => setBarIdle(true), BAR_IDLE_MS);
    const wake = () => {
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

  // Driving, the voice keeps a running commentary (commentary.ts): why each
  // change of network happened, what the road map saw coming, each rover
  // losing its link - and what it was missing - and getting it back, and how
  // the run ended. Every line is built from the two runs' own events and said
  // as the run reaches it; when several fall together, as at the cutting, the
  // more important go first and the rest are dropped once they are old news.
  const commentary = useMemo(
    () =>
      view === 'drive' && runId
        ? driveCommentary({
            main: run.source.timeline,
            mainName,
            baseline: baselineId ? baseline.source.timeline : null,
            zones: deadZones,
            reverse,
            routeLength: route.length,
            completed,
          })
        : [],
    // The timelines grow in place; each run's `latest` says when.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, runId, baselineId, run.latest, baseline.latest, mainName, deadZones, reverse, completed],
  );
  const said = useRef<{ run: string | null; keys: Set<string>; t: number }>({ run: null, keys: new Set(), t: 0 });
  const nowT = run.latest?.t ?? 0;
  useEffect(() => {
    const memory = said.current;
    if (memory.run !== runId) {
      // Another run - a new choice, a replay: what the last one was saying is moot.
      if (memory.run !== null) narrator.stop();
      Object.assign(memory, { run: runId, keys: new Set<string>(), t: 0 });
    }
    // Scrubbed back: what lies ahead may be said again when the run gets there.
    if (nowT < memory.t - 1.5) {
      for (const line of commentary) if (line.at > nowT) memory.keys.delete(line.key);
    }
    memory.t = nowT;
    for (const line of commentary) {
      if (line.at > nowT || memory.keys.has(line.key)) continue;
      memory.keys.add(line.key);
      // Long past - a seek forward, a replay - is not news.
      if (nowT - line.at > line.keep) continue;
      narrator.say(line.text, { kind: 'announcement', priority: line.priority, keepMs: line.keep * 1000 });
    }
  }, [commentary, nowT, runId]);

  return (
    <AppShell
      variant="immersive"
      bar={<RunStatusBar state={run.state} connection={run.connection} stale={run.stale} dropped={run.droppedSequences} />}
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
          t={t}
          duration={duration}
          playing={playing && !run.stale}
          className="scene-shell-bleed absolute inset-0 h-full w-full"
          preview={!runId}
          camera={view === 'story' && runId ? 'story' : camera}
          storyShot={story.shot}
          speed={run.state?.speed ?? 1}
          deadZones={deadZones}
          inset={landing ? undefined : inset}
          still={landing}
          flights={flights && view !== 'story'}
          coverage={coverage && view === 'drive'}
          companion={twoRovers ? baseline.source : null}
          roverName={mainName}
        />

        {/* --- top centre: can each operator reach their rover? --------------- */}
        {/* The run's ending says how it went; the live status steps aside for it. */}
        <div
          className="pointer-events-none absolute top-3 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-2 transition-opacity duration-300"
          style={showSummary ? { opacity: 0 } : undefined}
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
              main={run.latest}
              mainName={mainName}
              mainTimeline={run.source.timeline}
              baseline={baselineId ? baselineEvent : undefined}
              baselineTimeline={baselineId ? baseline.source.timeline : undefined}
              totals={view === 'drive' && detail}
            />
          )}
          {runId && run.latest && view === 'drive' && detail && (
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
          {moment && (
            <Moment moment={moment} holdSeconds={moment.kind === 'warning' ? WARNING_VISIBLE_S : HANDOFF_VISIBLE_S} />
          )}
        </div>

        {/* --- the landing: what this is, and the one way in ------------------------- */}
        {landing && (
          <div className={`absolute inset-x-0 z-10 flex justify-center px-3 ${bootError ? 'top-[30%]' : 'top-[14%]'}`}>
            <StoryLanding onDrive={startDrive} busy={busy} />
          </div>
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

        {showSummary && runId && (
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
              event={run.latest}
              history={run.history}
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
        {(view === 'drive' || (view === 'story' && runId && !story.finished)) && run.latest && (
          <aside className="mission-side mission-right scroll-y enter-late flex flex-col gap-3 *:shrink-0">
            <HeadToHead
              main={run.latest}
              baseline={baselineId ? baselineEvent : undefined}
              mainName={mainName}
              camera={
                detail && view === 'drive' ? undefined : (
                  <CameraFeed
                    event={run.latest}
                    baseline={baselineId ? baselineEvent : undefined}
                    timeline={run.source.timeline}
                    baselineTimeline={baselineId ? baseline.source.timeline : undefined}
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
                  <ApplicationPanel event={run.latest} />
                </div>
                <div className="enter-late">
                  <CameraFeed
                    event={run.latest}
                    baseline={baselineId ? baselineEvent : undefined}
                    baselineLabel="Normal rover"
                    mainLabel={mainName}
                    defaultOpen={false}
                  />
                </div>
                <RouteMap event={run.latest} events={run.decisions} reverse={reverse} />
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
            data-tour="mission-timeline"
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
              latest={run.latest}
              decisions={run.decisions}
              history={run.history}
              onStart={start}
              onToggle={() => control(playing ? 'pause' : 'play')}
              onReset={() => control('reset')}
              onReplay={replay}
              onSpeed={(speed) => control('speed', { speed })}
              onSeek={seek}
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
                  <CameraSwitch value={camera} onChange={setCamera} />
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

        {driveTour.open && (
          <Tour
            steps={DRIVE_TOUR}
            step={driveTour.step}
            onStep={driveTour.setStep}
            onClose={driveTour.close}
            finishLabel={tourFinish}
            label="How to read the drive"
          />
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

/** The voice that says what is happening: on, off, or waiting for a click the browser asked for. */
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
        title="The browser held the voice back until the page is clicked: click to hear what each rover does, said aloud"
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
      aria-label={on ? 'Turn the voice off' : 'Say what happens aloud'}
      title={
        on
          ? 'Voice on: what each rover does - each change of network and why, each lost link and how long it lasted - is said aloud. Click to turn it off.'
          : 'Voice off. Click to hear what each rover does, said aloud.'
      }
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
