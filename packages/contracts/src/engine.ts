/**
 * TypeScript mirror of `services/engine/continua_engine/contracts.py`.
 *
 * These are *validated at the boundary*, not merely asserted: `parseEngineEvent`
 * rejects a payload whose shape it does not recognise rather than letting the
 * dashboard render something it cannot vouch for. If the two sides drift, the
 * UI shows a schema error - which is a far better failure than a plausible
 * looking number that means nothing.
 *
 * The honesty rule from Phase 1 still holds and is enforced by the types:
 * a measurement that does not exist is `null`, never `0`.
 */

export const ENGINE_SCHEMA_VERSION = '2.1.0';

export const LINK_IDS = ['wired', 'wifi', 'cellular', 'satellite'] as const;
export type EngineLinkId = (typeof LINK_IDS)[number];

export const TRAFFIC_CLASSES = ['control', 'telemetry', 'video', 'voice', 'bulk'] as const;
export type TrafficClassId = (typeof TRAFFIC_CLASSES)[number];

export type ExecutionMode = 'simulation' | 'emulation' | 'replay';

export type LinkPhase =
  | 'unavailable'
  | 'available'
  | 'activating'
  | 'validating'
  | 'active'
  | 'carrying';

export type ControllerStateId =
  | 'stable'
  | 'at_risk'
  | 'warming_backup'
  | 'validating_backup'
  | 'switching'
  | 'recovering'
  | 'degraded'
  | 'disconnected';

export type PipelineStageId = 'observe' | 'predict' | 'prepare' | 'steer' | 'explain';

export type PolicyIdString =
  | 'B0'
  | 'B1'
  | 'B2'
  | 'P1'
  | 'P1-noPred'
  | 'P1-noApp'
  // Phase 4
  | 'B2-defer'
  | 'P2'
  | 'P2-noSteer'
  | 'P2-noMode'
  | 'P2-reactiveMode';

/**
 * Operating mode of the control class (Phase 4). `teleop` is the Phase 2
 * behaviour; policies without mode handover report it for the whole run. The
 * mode describes the command channel only: it never changes the modelled
 * vehicle motion.
 */
export const CONTROL_MODES = ['teleop', 'waypoint', 'safe_hold'] as const;
export type ControlModeId = (typeof CONTROL_MODES)[number];

export type ActionKindId =
  | 'none'
  | 'activate_backup'
  | 'validate_backup'
  | 'switch'
  | 'start_duplication'
  | 'stop_duplication'
  | 'throttle_class'
  | 'restore_class'
  | 'release_backup'
  | 'safe_stop'
  | 'resume'
  // Phase 4
  | 'mode_change'
  | 'steer_class';

export interface EngineLinkObservation {
  link: EngineLinkId;
  phase: LinkPhase;
  window_s: number;
  rtt_ms: number | null;
  jitter_ms: number | null;
  loss_pct: number | null;
  throughput_mbps: number | null;
  /** Wi-Fi only. Every other link has no such measurement and reports null. */
  rssi_dbm: number | null;
  /** Geometric coverage from the simulator's world model. Not a measurement. */
  modelled_coverage: number | null;
  queue_depth_bytes: number;
  capacity_mbps: number | null;
  samples: number;
  link_bytes: number;
}

export interface EngineClassHealth {
  traffic_class: TrafficClassId;
  window_s: number;
  sent: number;
  delivered: number;
  duplicates_suppressed: number;
  deadline_miss_pct: number | null;
  p50_latency_ms: number | null;
  p95_latency_ms: number | null;
  p99_latency_ms: number | null;
  freshness_ms: number | null;
  stall_ms: number | null;
  /** Whether video is stalled at this instant, as judged by the receiver. */
  stalled_now: boolean | null;
  frames_delivered: number;
  frames_expected: number;
  goodput_mbps: number | null;
  bytes_completed: number;
}

export interface EngineApplicationHealth {
  window_s: number;
  classes: Partial<Record<TrafficClassId, EngineClassHealth>>;
  /** `app_health_v1`. Definition in docs/METRICS.md - never an unexplained score. */
  health_score: number | null;
  health_definition: string;
  session_id: string;
  session_reconnects: number;
  outage_s: number;
  in_outage: boolean;
  safe_stop: boolean;
}

export interface EnginePrediction {
  predictor: string;
  horizon_s: number;
  violation_expected: boolean;
  /** Only a probability when `calibrated` is true. Otherwise a bounded score. */
  score: number | null;
  calibrated: boolean;
  threshold: string;
  features: Record<string, number>;
}

export interface EngineAction {
  kind: ActionKindId;
  link: EngineLinkId | null;
  traffic_class: TrafficClassId | null;
  detail: Record<string, number | string | boolean>;
}

export interface EngineVehicle {
  distance_m: number;
  speed_mps: number;
  heading_rad: number;
  zone: string;
}

export interface EngineEvent {
  schema_version: string;
  run_id: string;
  mode: ExecutionMode;
  seq: number;
  t: number;
  wall_clock: string;
  stage: PipelineStageId;
  controller_state: ControllerStateId;
  carrying: EngineLinkId | null;
  links: Partial<Record<EngineLinkId, EngineLinkObservation>>;
  vehicle: EngineVehicle | null;
  app: EngineApplicationHealth | null;
  prediction: EnginePrediction | null;
  action: EngineAction | null;
  /**
   * Every action taken at this decision, in order; `action` is the first of
   * them. A `mode_change` that accompanies a `switch` precedes it here.
   * Absent on events recorded before schema 2.1.
   */
  actions?: EngineAction[];
  reason: string;
  policy_version: string;
  policy_id: PolicyIdString;
  scenario_id: string;
  /** Phase 4. Absent on events recorded before schema 2.1: read as `teleop`. */
  control_mode?: ControlModeId;
  /**
   * Phase 4: which active path each traffic class rides. Absent on events
   * recorded before schema 2.1, and empty when there is no carrying path; in
   * both cases every class rides `carrying`.
   */
  class_paths?: Partial<Record<TrafficClassId, EngineLinkId>>;
}

export interface EngineRunState {
  run_id: string;
  mode: ExecutionMode;
  scenario_id: string;
  scenario_title: string;
  policy_id: string;
  seed: number;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  t: number;
  duration_s: number;
  speed: number;
  seq: number;
  predictor: string;
  horizon_s: number;
  /** Present only for replay. Identifies what was originally recorded. */
  source?: { mode: ExecutionMode; run_id: string | null; recorded_at: string | null };
}

export type EngineSocketMessage =
  | { type: 'snapshot'; state: EngineRunState; event: EngineEvent | null }
  | { type: 'event'; event: EngineEvent }
  | { type: 'tick'; state: EngineRunState }
  | { type: 'seek'; state: EngineRunState; event: EngineEvent | null }
  | { type: 'status'; state: EngineRunState; metrics?: unknown }
  | { type: 'error'; detail: string; run_id?: string };

// ---------------------------------------------------------------------------
// Boundary validation
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Structural check. Returns null (and logs) rather than throwing into React. */
export function parseEngineEvent(raw: unknown): EngineEvent | null {
  if (!isRecord(raw)) return null;
  const required = ['run_id', 'seq', 't', 'stage', 'controller_state', 'links'];
  for (const key of required) {
    if (!(key in raw)) {
      console.warn(`[CONTINUA] engine event missing "${key}"; ignoring`, raw);
      return null;
    }
  }
  if (
    typeof raw.schema_version === 'string' &&
    raw.schema_version.split('.')[0] !== ENGINE_SCHEMA_VERSION.split('.')[0]
  ) {
    console.warn(
      `[CONTINUA] engine schema ${raw.schema_version} != expected ${ENGINE_SCHEMA_VERSION}`,
    );
  }
  if (num(raw.t) === null || num(raw.seq) === null) return null;
  if (!isRecord(raw.links)) return null;
  // Phase 4 fields are optional (older recordings lack them) but, when
  // present, must be well formed: a mode or a path the UI does not know is
  // rejected rather than rendered as something it is not.
  if (raw.control_mode !== undefined && raw.control_mode !== null) {
    if (!(CONTROL_MODES as readonly string[]).includes(String(raw.control_mode))) {
      console.warn(`[CONTINUA] unknown control_mode "${String(raw.control_mode)}"; ignoring event`);
      return null;
    }
  }
  if (raw.class_paths !== undefined && raw.class_paths !== null) {
    if (!isRecord(raw.class_paths)) return null;
    for (const [cls, link] of Object.entries(raw.class_paths)) {
      if (
        !(TRAFFIC_CLASSES as readonly string[]).includes(cls) ||
        !(LINK_IDS as readonly string[]).includes(String(link))
      ) {
        console.warn(`[CONTINUA] malformed class_paths entry ${cls}=${String(link)}; ignoring event`);
        return null;
      }
    }
  }
  if (raw.actions !== undefined && raw.actions !== null && !Array.isArray(raw.actions)) return null;
  return raw as unknown as EngineEvent;
}

/** The control mode an event reports, reading pre-2.1 recordings as teleop. */
export function controlModeOf(event: EngineEvent | null | undefined): ControlModeId {
  return event?.control_mode ?? 'teleop';
}

/** The path a class rides in an event: its class path, else the carrying path. */
export function classPathOf(
  event: EngineEvent | null | undefined,
  cls: TrafficClassId,
): EngineLinkId | null {
  if (!event) return null;
  return event.class_paths?.[cls] ?? event.carrying ?? null;
}

/** Every action an event carries, including the first one. */
export function actionsOf(event: EngineEvent | null | undefined): EngineAction[] {
  if (!event) return [];
  if (event.actions && event.actions.length > 0) return event.actions;
  return event.action && event.action.kind !== 'none' ? [event.action] : [];
}

export function parseSocketMessage(raw: unknown): EngineSocketMessage | null {
  if (!isRecord(raw) || typeof raw.type !== 'string') return null;
  switch (raw.type) {
    case 'event': {
      const event = parseEngineEvent(raw.event);
      return event ? { type: 'event', event } : null;
    }
    case 'snapshot':
    case 'seek':
      return {
        type: raw.type,
        state: raw.state as EngineRunState,
        event: raw.event ? parseEngineEvent(raw.event) : null,
      };
    case 'tick':
    case 'status':
      return { type: raw.type, state: raw.state as EngineRunState, metrics: raw.metrics } as EngineSocketMessage;
    case 'error':
      return { type: 'error', detail: String(raw.detail ?? 'unknown error') };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Display helpers - the honesty layer
// ---------------------------------------------------------------------------

/**
 * Format a measurement that may not exist.
 *
 * The whole point: `null` renders as a placeholder and the caller can show
 * "unavailable". It never renders as `0`, because zero latency and unknown
 * latency are completely different claims.
 */
export function formatMeasurement(
  value: number | null | undefined,
  options: { unit?: string; digits?: number } = {},
): { text: string; available: boolean } {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return { text: ' - ', available: false };
  }
  const digits = options.digits ?? 0;
  return { text: `${value.toFixed(digits)}${options.unit ?? ''}`, available: true };
}

export const LINK_LABEL: Record<EngineLinkId, { label: string; sublabel: string }> = {
  wired: { label: 'Wired', sublabel: 'Ethernet' },
  wifi: { label: 'Wi-Fi', sublabel: '2.4 / 5 GHz' },
  cellular: { label: 'Cellular', sublabel: 'Macro site profile' },
  satellite: { label: 'Satellite', sublabel: 'GEO-like profile' },
};

export const CONTROLLER_STATE_LABEL: Record<ControllerStateId, string> = {
  stable: 'Stable',
  at_risk: 'At risk',
  warming_backup: 'Warming backup',
  validating_backup: 'Validating backup',
  switching: 'Switching',
  recovering: 'Recovering',
  degraded: 'Degraded',
  disconnected: 'Disconnected',
};

export const STAGE_LABEL: Record<PipelineStageId, string> = {
  observe: 'Observe',
  predict: 'Predict',
  prepare: 'Prepare',
  steer: 'Steer',
  explain: 'Explain',
};

export const ACTION_LABEL: Record<ActionKindId, string> = {
  none: 'No action',
  activate_backup: 'Activate backup',
  validate_backup: 'Validate backup',
  switch: 'Switch path',
  start_duplication: 'Start duplication',
  stop_duplication: 'Stop duplication',
  throttle_class: 'Throttle class',
  restore_class: 'Restore class',
  release_backup: 'Release backup',
  safe_stop: 'Safe stop',
  resume: 'Resume',
  mode_change: 'Control mode',
  steer_class: 'Steer class',
};

export const CONTROL_MODE_LABEL: Record<ControlModeId, string> = {
  teleop: 'Teleop',
  waypoint: 'Waypoint',
  safe_hold: 'Safe hold',
};

export const POLICY_NAME: Record<PolicyIdString, string> = {
  B0: 'Single path',
  B1: 'Reactive multipath',
  B2: 'Always-on redundancy',
  P1: 'CONTINUA',
  'P1-noPred': 'CONTINUA, no predictor',
  'P1-noApp': 'CONTINUA, no app-awareness',
  'B2-defer': 'Always-on redundancy, bulk deferred',
  P2: 'CONTINUA P2',
  'P2-noSteer': 'P2, no per-class steering',
  'P2-noMode': 'P2, no mode handover',
  'P2-reactiveMode': 'P2, reactive mode only',
};
