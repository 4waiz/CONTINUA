/**
 * Replay recorded runs with no engine behind them.
 *
 * The CONTINUA engine is Python - FastAPI, numpy, scikit-learn - and does not
 * run in a browser, so the public deployment has no backend at all. Rather than
 * ship an interface whose controls all point at "install Python first", every
 * scenario is run against every policy ahead of time by the real engine and
 * exported by `scripts/build_demo_data.py`. Whatever a visitor selects, there
 * is a recording of it.
 *
 * That is not a simulation of a simulation, and re-implementing the simulator
 * in TypeScript was the alternative that would have been: a second engine
 * disagreeing with the one every measured number in the project came from.
 * Replay is a mode the engine already supports and the interface already
 * labels, so the badge reads `REPLAY · SIMULATION` exactly as it does against a
 * live engine, with the source run and its recording time attached.
 *
 * The player emits the same message shapes as the WebSocket, so `useEngineRun`
 * feeds both through one code path and no component knows the difference.
 */

import type {
  EngineEvent,
  EngineRunState,
  EngineSocketMessage,
} from '@continua/contracts/engine';
import type { CapabilityReport, PolicySpec, RunRow, ScenarioSpec } from './api';

export interface DemoRunSummary {
  run_id: string;
  blurb: string;
  scenario_id: string;
  scenario_title: string;
  policy_id: string;
  seed: number;
  predictor: string | null;
  mode: string;
  started_at: string | null;
  duration_s: number;
  events: number;
}

export interface DemoIndex {
  generated_at: string;
  note: string;
  seed: number;
  policies: string[];
  runs: DemoRunSummary[];
  experiments: Record<string, unknown>[];
  scenarios: ScenarioSpec[];
  capability: CapabilityReport | null;
}

/** One run as it sits on disk: metadata plus a columnar event stream. */
interface EncodedRun {
  run_id: string;
  blurb: string;
  manifest: Record<string, unknown>;
  metrics: Record<string, unknown> | null;
  duration_s: number;
  encoding: 'columnar-1';
  events: {
    count: number;
    /** Leaf values by dotted field path, one entry per event. */
    columns: Record<string, unknown[]>;
    /** 0/1 per event for every path that holds a nested object. */
    objects: Record<string, number[]>;
  };
}

interface DemoRunPayload {
  run_id: string;
  blurb: string;
  manifest: Record<string, unknown>;
  metrics: Record<string, unknown> | null;
  duration_s: number;
  events: EngineEvent[];
}

/**
 * Rebuild the event stream the exporter transposed.
 *
 * An event is a deep object of ~200 fields and a run is a thousand of them, so
 * written per event the field *names* dominate the file. One array per field
 * path writes each name once and cuts a run from 4.2 MB to 1.4 MB. This is the
 * exact inverse: no value is altered, rounded or filled in here.
 *
 * `objects` is what makes it lossless. `prediction: null` and `prediction: {}`
 * are different facts, and a bag of null leaves cannot tell them apart, so the
 * exporter records presence separately and this walks it before the leaves.
 */
function decodeRun(encoded: EncodedRun): DemoRunPayload {
  const { count, columns, objects } = encoded.events;
  const events: EngineEvent[] = [];

  // Shallowest first, so a parent object exists before its children are placed.
  const objectPaths = Object.keys(objects).sort(
    (a, b) => a.split('.').length - b.split('.').length || a.localeCompare(b),
  );
  const leafPaths = Object.keys(columns);

  for (let i = 0; i < count; i += 1) {
    const event: Record<string, unknown> = {};

    for (const path of objectPaths) {
      const segments = path.split('.');
      const parent = descend(event, segments.slice(0, -1));
      // A missing parent means an ancestor was null for this event, so this
      // path has nothing to attach to.
      if (!parent) continue;
      parent[segments[segments.length - 1]!] = objects[path]![i] ? {} : null;
    }

    for (const path of leafPaths) {
      const segments = path.split('.');
      const parent = descend(event, segments.slice(0, -1));
      if (!parent) continue;
      parent[segments[segments.length - 1]!] = columns[path]![i] ?? null;
    }

    events.push(event as unknown as EngineEvent);
  }

  return {
    run_id: encoded.run_id,
    blurb: encoded.blurb,
    manifest: encoded.manifest,
    metrics: encoded.metrics,
    duration_s: encoded.duration_s,
    events,
  };
}

/** Follow `segments` into `root`, or null if any step is not an object. */
function descend(root: Record<string, unknown>, segments: string[]): Record<string, unknown> | null {
  let node: Record<string, unknown> = root;
  for (const segment of segments) {
    const next = node[segment];
    if (next === null || typeof next !== 'object') return null;
    node = next as Record<string, unknown>;
  }
  return node;
}

/** How often the cursor advances while playing. 20 Hz matches the engine tick. */
const TICK_MS = 50;

// --- one-shot fetches, cached ------------------------------------------------

let indexPromise: Promise<DemoIndex> | null = null;
const runPromises = new Map<string, Promise<DemoRunPayload>>();

async function fetchJson<T>(url: string, cache: RequestCache): Promise<T> {
  const response = await fetch(url, { cache });
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  return (await response.json()) as T;
}

/**
 * The catalogue revalidates on every load. It is one small file at a stable
 * URL, and a redeploy rewrites it: served from cache without asking, a
 * returning visitor would hold yesterday's run ids and get a page of 404s.
 */
export function demoIndex(): Promise<DemoIndex> {
  indexPromise ??= fetchJson<DemoIndex>('/demo/index.json', 'no-cache');
  return indexPromise;
}

/**
 * A run, by contrast, is immutable: its id is assigned when it is recorded, so
 * a given URL's bytes never change and the cache can be trusted outright.
 */
function demoRun(runId: string): Promise<DemoRunPayload> {
  let existing = runPromises.get(runId);
  if (!existing) {
    existing = fetchJson<EncodedRun>(`/demo/runs/${runId}.json`, 'force-cache').then(decodeRun);
    runPromises.set(runId, existing);
  }
  return existing;
}

/**
 * Find the recording for one scenario and policy.
 *
 * Every combination the interface offers has one, because the exporter runs the
 * whole matrix. A miss means the catalogue and the recordings are out of step,
 * which is a build problem, not something to paper over at runtime.
 */
export function findDemoRun(
  runs: DemoRunSummary[],
  scenarioId: string,
  policyId: string,
): DemoRunSummary | null {
  return (
    runs.find((run) => run.scenario_id === scenarioId && run.policy_id === policyId) ?? null
  );
}

// --- the player --------------------------------------------------------------

type Listener = (message: EngineSocketMessage) => void;

export class StaticRunPlayer {
  private events: EngineEvent[] = [];
  private payload: DemoRunPayload | null = null;
  private index = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastWall = 0;
  private listeners = new Set<Listener>();

  t = 0;
  speed = 1;
  status: EngineRunState['status'] = 'pending';
  /**
   * Set only by an operator pressing pause, never by the player suspending
   * itself when the last view unmounts. Without the distinction, React's
   * development double-mount would look like a pause and the run would never
   * start.
   */
  userPaused = false;

  constructor(readonly runId: string) {}

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    // A late subscriber still needs the picture so far, not just what happens
    // next: replay everything up to the cursor before handing over live events.
    if (this.payload) this.emitCatchUp(listener);
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.suspend();
    };
  }

  async load(): Promise<void> {
    if (this.payload) return;
    const payload = await demoRun(this.runId);
    this.payload = payload;
    this.events = payload.events;
    this.status = 'paused';
    for (const listener of this.listeners) this.emitCatchUp(listener);
  }

  state(): EngineRunState {
    const manifest = (this.payload?.manifest ?? {}) as Record<string, never>;
    const scenario = (manifest.scenario ?? {}) as unknown as { id?: string; title?: string };
    return {
      run_id: this.runId,
      // Honest by construction: this is a replay of a recorded simulation, and
      // the badge renders it as such.
      mode: 'replay',
      scenario_id: scenario.id ?? '',
      scenario_title: scenario.title ?? '',
      policy_id: (manifest.policy_id as unknown as string) ?? '',
      seed: (manifest.seed as unknown as number) ?? 0,
      status: this.status,
      t: this.t,
      duration_s: this.payload?.duration_s ?? 0,
      speed: this.speed,
      seq: this.events[Math.max(0, this.index - 1)]?.seq ?? 0,
      predictor: (manifest.predictor as unknown as string) ?? 'heuristic',
      horizon_s: (manifest.horizon_s as unknown as number) ?? 3,
      source: {
        mode: 'simulation',
        run_id: this.runId,
        recorded_at: (manifest.started_at as unknown as string) ?? null,
      },
    };
  }

  play(): void {
    this.userPaused = false;
    if (!this.payload || this.timer) return;
    if (this.t >= (this.payload.duration_s || 0)) this.seek(0);
    this.status = 'running';
    this.lastWall = performance.now();
    this.timer = setInterval(() => this.advance(), TICK_MS);
    this.broadcast({ type: 'status', state: this.state() });
  }

  pause(): void {
    this.userPaused = true;
    this.suspend();
  }

  /** Stop the clock without recording an intent to stay stopped. */
  suspend(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.status === 'running') {
      this.status = 'paused';
      this.broadcast({ type: 'status', state: this.state() });
    }
  }

  setSpeed(speed: number): void {
    this.speed = speed;
    this.broadcast({ type: 'status', state: this.state() });
  }

  /**
   * Move the cursor. Unlike the engine's replay, this re-emits the whole
   * history up to the target rather than just the last event, so the charts
   * have something to draw after a scrub instead of a single point.
   */
  seek(target: number): void {
    if (!this.payload) return;
    this.t = Math.max(0, Math.min(target, this.payload.duration_s));
    this.index = 0;
    this.broadcast({ type: 'snapshot', state: this.state(), event: null });
    while (this.index < this.events.length && this.events[this.index]!.t <= this.t) {
      this.broadcast({ type: 'event', event: this.events[this.index]! });
      this.index += 1;
    }
    this.broadcast({ type: 'tick', state: this.state() });
  }

  reset(): void {
    this.suspend();
    this.seek(0);
  }

  // --- internals -------------------------------------------------------------

  private advance(): void {
    if (!this.payload) return;
    const now = performance.now();
    const delta = ((now - this.lastWall) / 1000) * this.speed;
    this.lastWall = now;
    this.t = Math.min(this.t + delta, this.payload.duration_s);

    while (this.index < this.events.length && this.events[this.index]!.t <= this.t) {
      this.broadcast({ type: 'event', event: this.events[this.index]! });
      this.index += 1;
    }
    this.broadcast({ type: 'tick', state: this.state() });

    if (this.t >= this.payload.duration_s) {
      this.suspend();
      this.status = 'completed';
      this.broadcast({ type: 'status', state: this.state() });
    }
  }

  private emitCatchUp(listener: Listener): void {
    listener({ type: 'snapshot', state: this.state(), event: null });
    for (let i = 0; i < this.index; i += 1) {
      listener({ type: 'event', event: this.events[i]! });
    }
    listener({ type: 'tick', state: this.state() });
  }

  private broadcast(message: EngineSocketMessage): void {
    for (const listener of this.listeners) listener(message);
  }
}

// --- one player per run, shared across components ---------------------------

const players = new Map<string, StaticRunPlayer>();

export function getStaticPlayer(runId: string): StaticRunPlayer {
  let player = players.get(runId);
  if (!player) {
    player = new StaticRunPlayer(runId);
    players.set(runId, player);
  }
  return player;
}

/** Drive a player from the same verbs the engine's control endpoint takes. */
export function staticControl(
  runId: string,
  body: { action: 'play' | 'pause' | 'reset' | 'seek' | 'speed' | 'stop'; t?: number; speed?: number },
): { state: EngineRunState } {
  const player = getStaticPlayer(runId);
  switch (body.action) {
    case 'play':
      if (body.speed !== undefined) player.setSpeed(body.speed);
      player.play();
      break;
    case 'pause':
    case 'stop':
      player.pause();
      break;
    case 'reset':
      player.reset();
      break;
    case 'seek':
      player.seek(body.t ?? 0);
      break;
    case 'speed':
      player.setSpeed(body.speed ?? 1);
      break;
  }
  return { state: player.state() };
}

// --- the read-only slice of the API the static build can still answer -------

export const demoApi = {
  scenarios: async () => ({ scenarios: (await demoIndex()).scenarios }),

  /**
   * Policy specs are not exported: nothing in the static build can start a run
   * with one. The ids are enough for the selectors to render the comparison.
   */
  policies: async (): Promise<{ policies: PolicySpec[]; violation_definition: string }> => ({
    policies: (['B0', 'B1', 'B2', 'P1'] as const).map(
      (id) =>
        ({
          id,
          multipath: id !== 'B0',
          proactive_warm: id === 'P1' || id === 'B2',
          use_prediction: id === 'P1',
          always_redundant: id === 'B2',
          app_aware: id === 'P1',
          min_dwell_s: 2,
          predictor: id === 'P1' ? 'heuristic-trend-1.1' : 'none',
        }) as PolicySpec,
    ),
    violation_definition:
      'RTT above the control deadline, loss above 3 %, or the path becoming unusable.',
  }),

  capability: async () => {
    const report = (await demoIndex()).capability;
    if (!report) throw new Error('No capability report in the demo data.');
    return report;
  },

  listRuns: async (): Promise<{ runs: RunRow[]; live: EngineRunState[] }> => {
    const index = await demoIndex();
    return {
      runs: index.runs.map((run) => ({
        run_id: run.run_id,
        mode: run.mode,
        scenario_id: run.scenario_id,
        policy_id: run.policy_id,
        seed: run.seed,
        status: 'completed',
        started_at: run.started_at ?? '',
        finished_at: run.started_at,
        duration_s: run.duration_s,
        events: run.events,
        source_mode: null,
        source_run_id: null,
        recorded_at: run.started_at,
        code_commit: null,
        predictor: run.predictor,
        horizon_s: 3,
      })),
      live: [],
    };
  },

  getRun: async (runId: string) => {
    const payload = await demoRun(runId);
    return { run_id: runId, manifest: payload.manifest, metrics: payload.metrics } as Record<
      string,
      unknown
    >;
  },

  getRunEvents: async (runId: string) => {
    const payload = await demoRun(runId);
    return {
      run_id: runId,
      total: payload.events.length,
      offset: 0,
      events: payload.events as unknown[],
    };
  },

  getRunMetrics: async (runId: string) => {
    const payload = await demoRun(runId);
    return (payload.metrics ?? {}) as Record<string, unknown>;
  },

  listExperiments: async () => ({
    stored: (await demoIndex()).experiments,
    in_flight: {},
  }),

  // Like runs, an experiment id identifies its contents.
  getExperiment: async (id: string) =>
    fetchJson<Record<string, unknown>>(`/demo/experiments/${id}.json`, 'force-cache'),
};

/** Thrown by anything that genuinely needs the engine. */
export class NeedsEngineError extends Error {
  constructor(action: string) {
    super(
      `${action} needs the CONTINUA engine, which runs locally rather than on this site. ` +
        'The runs shown here were recorded by that engine and are being replayed.',
    );
    this.name = 'NeedsEngineError';
  }
}
