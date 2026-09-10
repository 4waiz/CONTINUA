/**
 * @continua/scene - the reusable CONTINUA 3D scene.
 *
 * Deliberately usable outside `/scene-lab`: the landing page mounts the same
 * `<ContinuaScene>` inside a dashboard frame, and the Phase 3 capture harness
 * will drive the same clock and source.
 */

// --- runtime ---------------------------------------------------------------
export {
  SceneRuntimeProvider,
  useSceneRuntime,
  useSceneSettings,
  useSetSceneSettings,
  usePlayback,
  useThrottledSceneState,
  useSceneKeyboard,
  type SceneSettings,
  type SceneRuntime,
} from './runtime/SceneRuntime';
export { SceneClock } from './core/clock';

// --- state sources ---------------------------------------------------------
export { PreviewSceneStateSource, previewSource, VEHICLE } from './preview/previewSource';
export { EngineSceneStateSource } from './engine/engineSource';

// --- world model -----------------------------------------------------------
export { Route, route, ROUTE_CONTROL_POINTS, type RouteSample } from './world/route';
export { Terrain, terrain, TERRAIN, baseHeight, ridgeHeight } from './world/terrain';
export {
  buildRouteRibbon,
  roadSurfaceY,
  ROAD_HALF_WIDTH,
  ROAD_SURFACE_OFFSET,
} from './world/road';
export {
  SITES,
  MISSION_ZONES,
  ZONE_OVERVIEWS,
  NETWORK_PRIORITY,
  USABLE_COVERAGE,
  coverageAt,
  zoneAtDistance,
  siteElevation,
  type SiteMarker,
} from './world/sites';

// --- components ------------------------------------------------------------
export { ContinuaScene, type ContinuaSceneProps } from './components/ContinuaScene';
export { Ground } from './components/Ground';
export { Lighting } from './components/Lighting';
export { Rover, ROVER_MODEL_URL, ROVER_MODEL_LOD1_URL } from './components/Rover';
export { WorldProps, PROPS_MODEL_URL } from './components/WorldProps';
export { CoverageOverlay, LinkBeams } from './components/Network';
export { SceneCameras } from './components/Cameras';

// --- design tokens ---------------------------------------------------------
export { COLOR, SCENE_COLOR, NETWORK_COLOR, SPACE, RADIUS, TYPE } from './theme';

// --- maths -----------------------------------------------------------------
export { clamp, lerp, smoothstep, angleDelta, fbm2, valueNoise2, makeRandom } from './math/noise';
