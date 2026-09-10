/**
 * CONTINUA shared contracts.
 *
 * Framework-free types describing everything the 3D scene needs to know about a
 * mission run, and everything the (Phase 2) predictive network engine will
 * publish. Nothing here imports React or three.js on purpose: the same shapes
 * are meant to travel over a websocket, through a test fixture, or into a video
 * capture manifest.
 *
 * Phase 1 ships a deterministic **preview** source. Phase 2 replaces the source,
 * not the contract.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Right-handed, Y-up, metres - matching the exported glTF runtime assets. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type Seconds = number;
export type Metres = number;
export type Radians = number;

// ---------------------------------------------------------------------------
// Access networks
// ---------------------------------------------------------------------------

/**
 * The four access networks. These are **alternative links to one gateway**,
 * not hops in a chain: a packet uses exactly one of them (or briefly two,
 * during a duplicated handoff). Any visualisation that draws them in series is
 * wrong.
 */
export const ACCESS_NETWORKS = ['wired', 'wifi', 'cellular', 'satellite'] as const;
export type AccessNetworkId = (typeof ACCESS_NETWORKS)[number];

export interface AccessNetworkMeta {
  readonly id: AccessNetworkId;
  readonly label: string;
  readonly sublabel: string;
  /** Design-system token name, resolved by the consumer. */
  readonly accent: 'cyan' | 'blue' | 'violet';
}

export const ACCESS_NETWORK_META: Readonly<Record<AccessNetworkId, AccessNetworkMeta>> = {
  wired: { id: 'wired', label: 'Wired', sublabel: 'Ethernet', accent: 'cyan' },
  wifi: { id: 'wifi', label: 'Wi-Fi', sublabel: '2.4 / 5 GHz', accent: 'cyan' },
  cellular: { id: 'cellular', label: 'Cellular', sublabel: 'Macro site profile', accent: 'blue' },
  satellite: { id: 'satellite', label: 'Satellite', sublabel: 'Link', accent: 'violet' },
};

/**
 * Lifecycle of one candidate link.
 *
 * `unavailable` -> out of coverage.
 * `available`   -> in coverage, idle, not carrying the session.
 * `warming`     -> being pre-established ahead of a predicted handoff.
 * `active`      -> currently carrying the session.
 * `degraded`    -> carrying the session but below the QoS target.
 */
export type LinkState = 'unavailable' | 'available' | 'warming' | 'active' | 'degraded';

export interface LinkStatus {
  readonly network: AccessNetworkId;
  readonly state: LinkState;
  /**
   * Modelled coverage strength, 0..1. In Phase 1 this is a geometric coverage
   * value derived from distance to the site - it is **not** a measured RSSI.
   */
  readonly coverage: number;
  /** Only present once a real engine is attached. Never synthesised for display. */
  readonly rssiDbm?: number;
  readonly latencyMs?: number;
  readonly jitterMs?: number;
  readonly lossPct?: number;
  readonly throughputMbps?: number;
  /** True only while physically docked or tethered. Wired is never mobile. */
  readonly tethered?: boolean;
}

// ---------------------------------------------------------------------------
// Vehicle
// ---------------------------------------------------------------------------

export interface VehiclePose {
  /** World position of the vehicle root, at the tyre contact plane. */
  readonly position: Vec3;
  /** Yaw about +Y. 0 = facing +X, which is the model's authored forward. */
  readonly heading: Radians;
  readonly pitch: Radians;
  readonly roll: Radians;
  /** Distance travelled along the route from the start of the run. */
  readonly distance: Metres;
  readonly speedMps: number;
  /** Front-wheel steering angle, positive = left. */
  readonly steerAngle: Radians;
  /** Accumulated wheel rotation, derived from `distance` and the tyre radius. */
  readonly wheelAngle: Radians;
}

// ---------------------------------------------------------------------------
// Traffic and decisions
// ---------------------------------------------------------------------------

export type TrafficProfile = 'telemetry' | 'video' | 'control' | 'bulk';

export interface TrafficState {
  readonly profile: TrafficProfile;
  readonly offeredMbps: number;
  readonly deliveredMbps: number;
  /** Continuous session identity. Surviving a handoff is the entire point. */
  readonly sessionId: string;
  readonly sessionUptimeS: Seconds;
  readonly handoffCount: number;
}

export type DecisionKind = 'observe' | 'predict' | 'prepare' | 'steer' | 'explain';

export interface Decision {
  readonly id: string;
  readonly at: Seconds;
  readonly kind: DecisionKind;
  readonly from?: AccessNetworkId;
  readonly to?: AccessNetworkId;
  /** Human-readable justification. Shown verbatim; never invented for effect. */
  readonly reason: string;
  /** 0..1 model confidence. Absent when no model produced the decision. */
  readonly confidence?: number;
}

// ---------------------------------------------------------------------------
// Mission zones
// ---------------------------------------------------------------------------

export type MissionZoneId = 'facility' | 'courtyard' | 'corridor' | 'remote';

export interface MissionZone {
  readonly id: MissionZoneId;
  readonly label: string;
  /** Route distance range this zone covers, in metres. */
  readonly fromDistance: Metres;
  readonly toDistance: Metres;
}

// ---------------------------------------------------------------------------
// The scene state adapter
// ---------------------------------------------------------------------------

/**
 * `preview` - geometry-derived illustration produced by Phase 1.
 * `engine` - measured/decided by the Phase 2 predictive engine.
 *
 * The HUD must display the source. Preview values are never labelled as
 * measured performance.
 */
export type SceneStateSourceKind = 'preview' | 'engine';

export interface SceneState {
  readonly runId: string;
  readonly source: SceneStateSourceKind;
  /** Simulation time in seconds. The single input that determines the frame. */
  readonly simTime: Seconds;
  readonly duration: Seconds;
  readonly zone: MissionZoneId;
  readonly vehicle: VehiclePose;
  readonly links: Readonly<Record<AccessNetworkId, LinkStatus>>;
  readonly active: AccessNetworkId | null;
  readonly warming: readonly AccessNetworkId[];
  readonly degraded: readonly AccessNetworkId[];
  readonly traffic: TrafficState;
  readonly latestDecision: Decision | null;
}

/**
 * The seam between the scene and whatever is driving it.
 *
 * Phase 1 implements this with `PreviewSceneStateSource`, which is a pure
 * function of `simTime`. Phase 2 supplies a live implementation; the scene
 * itself does not change.
 */
export interface SceneStateSource {
  readonly kind: SceneStateSourceKind;
  readonly runId: string;
  readonly duration: Seconds;
  /**
   * Must be pure and side-effect free: the same `simTime` always yields an
   * equal state. Phase 3 video capture depends on this.
   */
  sampleAt(simTime: Seconds): SceneState;
  /** Optional push channel for a live engine. Unused in Phase 1. */
  subscribe?(listener: (state: SceneState) => void): () => void;
}

// ---------------------------------------------------------------------------
// Camera and playback contracts (shared with the Phase 3 capture pipeline)
// ---------------------------------------------------------------------------

export type CameraMode = 'follow' | 'overview' | 'closeup' | 'turntable';
export type SceneMode = 'inspect' | 'mission';
export type QualityTier = 'high' | 'balanced' | 'low';

export interface PlaybackState {
  readonly playing: boolean;
  readonly simTime: Seconds;
  readonly speed: number;
}

/** One frame request for deterministic offline capture in Phase 3. */
export interface CaptureFrameRequest {
  readonly frame: number;
  readonly simTime: Seconds;
  readonly camera: CameraMode;
  readonly width: number;
  readonly height: number;
}
