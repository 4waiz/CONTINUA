'use client';

/**
 * The composed CONTINUA scene.
 *
 * Deliberately independent of the page it sits on: `/scene-lab`, the dashboard
 * frame on the landing page and (in Phase 3) the offline capture harness all
 * mount this same component.
 */

import { AdaptiveDpr, AdaptiveEvents, BakeShadows, PerformanceMonitor } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  HalfFloatType,
  NeutralToneMapping,
  PCFShadowMap,
  SRGBColorSpace,
  WebGLRenderTarget,
  type Camera,
  type DirectionalLight,
  type Object3D,
  type Scene,
  type WebGLRenderer,
} from 'three';
import type { QualityTier } from '@continua/contracts';
import { useFrame, useThree } from '@react-three/fiber';
import { SCENE_COLOR } from '../theme';
import {
  publishRenderer,
  useSceneRuntime,
  useSceneSettings,
  useSetSceneSettings,
} from '../runtime/SceneRuntime';
import { Ground } from './Ground';
import { Mountains, RoadsideScatter, Sea } from './Landscape';
import { Lighting } from './Lighting';
import { PostEffects } from './PostEffects';
import { RoverCam } from './RoverCam';
import { CoverageOverlay, LinkBeams } from './Network';
import { DeadZoneWalls } from './DeadZone';
import { Rover } from './Rover';
import { SceneCameras } from './Cameras';
import { WorldProps } from './WorldProps';

/** Sim time used by inspect mode: inside the dock dwell, so the rover is parked. */
const INSPECT_TIME = 2.5;

/**
 * Advances the clock and publishes this frame's state before anything else
 * reads it. Registered at priority -1 so it always runs first.
 */
/**
 * Seconds since the previous frame, by the frames' own timestamps.
 *
 * R3F's `delta` reads the wall clock when its loop happens to run, and on a
 * frame that also commits a React update (a link change re-renders every
 * panel) the loop runs late: that frame advanced the clock 30 ms, the next
 * 10 ms, and the rover lurched although every frame was presented on time.
 * `document.timeline.currentTime` is the frame's vsync-aligned start time,
 * the same for every callback in it.
 */
function frameDelta(last: { current: number | null }, fallback: number): number {
  const stamp = typeof document === 'undefined' ? null : document.timeline?.currentTime;
  if (typeof stamp !== 'number') return fallback;
  const previous = last.current;
  last.current = stamp;
  if (previous === null) return fallback;
  const seconds = (stamp - previous) / 1000;
  // A longer gap is the loop having been held (another page had the canvas),
  // not a slow frame: carry on from where it stopped.
  return seconds > 0.25 ? 1 / 60 : Math.max(0, seconds);
}

function SceneDriver({ frozen }: { frozen: boolean }) {
  const { clock, source, frame } = useSceneRuntime();
  const lastFrame = useRef<number | null>(null);
  useFrame((_, delta) => {
    clock.advance(frameDelta(lastFrame, delta));
    frame.current = source.sampleAt(frozen ? INSPECT_TIME : clock.time);
  }, -1);
  return null;
}

/**
 * Fires once the scene has actually drawn.
 *
 * It lives inside the `<Suspense>` boundary, so it cannot mount until every
 * glTF has resolved - which makes it a far more trustworthy "ready" signal than
 * drei's `useProgress`, whose loading-manager counters can settle at zero when
 * assets come from the preload cache.
 */
function FirstFrameSignal({ onFirstFrame }: { onFirstFrame?: () => void }) {
  const frames = useRef(0);
  const fired = useRef(false);
  useFrame(() => {
    if (fired.current) return;
    frames.current += 1;
    if (frames.current >= 3) {
      fired.current = true;
      performance.mark('continua:first-frames');
      onFirstFrame?.();
    }
  });
  return null;
}

/**
 * Publishes the live renderer state on `window.__CONTINUA__.three`.
 *
 * The browser smoke tests need to walk the real scene graph to prove the
 * exported rig survived - node names, materials, triangle counts. There is no
 * supported way to reach it from outside the Canvas, so the scene hands it out
 * explicitly. Preview data only.
 */
function DebugBridge() {
  const scene = useThree((state) => state.scene);
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const setFrameloop = useThree((state) => state.setFrameloop);
  useEffect(() => {
    publishRenderer({ scene, gl, camera, setFrameloop });
    return () => publishRenderer(null);
  }, [scene, gl, camera, setFrameloop]);
  // A frame here is several render calls - the scene with its shadows, the
  // ambient-occlusion passes, the output pass, the rover camera - and three
  // counts each call from zero by default, so `info` held the last one alone:
  // one draw call, one triangle, which the Scene Lab's readout then showed.
  // Counted per frame instead, from the start of each, so between frames
  // `info` holds one whole frame.
  useLayoutEffect(() => {
    gl.info.autoReset = false;
    return () => {
      gl.info.autoReset = true;
    };
  }, [gl]);
  useFrame(() => gl.info.reset(), -1000);
  return null;
}

/**
 * Draws everything once, off screen, before the first frame.
 *
 * `compileAsync` builds every program, but on ANGLE over Direct3D a program's
 * first draw still costs the main thread about a tenth of a second - measured
 * during the story - and that first draw used to be whenever its object first
 * showed: a link's ping at the first handoff, a building first caught by the
 * sun's shadow map as the rover drove up to it. Those were the story's
 * stutters. One draw of the whole scene - everything shown, nothing culled,
 * the shadow frustum stretched over the island - moves all of them here,
 * behind the loading overlay.
 */
function warmUp(gl: WebGLRenderer, scene: Scene, camera: Camera, toScreen: boolean): void {
  const undo: (() => void)[] = [];
  scene.traverse((object) => {
    if (!object.visible) {
      object.visible = true;
      undo.push(() => {
        object.visible = false;
      });
    }
    if (object.frustumCulled) {
      object.frustumCulled = false;
      undo.push(() => {
        object.frustumCulled = true;
      });
    }
    const light = object as DirectionalLight;
    if (light.isDirectionalLight && light.castShadow) {
      const shadow = light.shadow.camera;
      const { left, right, top, bottom, near, far } = shadow;
      Object.assign(shadow, { left: -2000, right: 2000, top: 2000, bottom: -2000, near: -3000, far: 3000 });
      shadow.updateProjectionMatrix();
      undo.push(() => {
        Object.assign(shadow, { left, right, top, bottom, near, far });
        shadow.updateProjectionMatrix();
      });
    }
  });
  const offscreen = new WebGLRenderTarget(1, 1, { type: HalfFloatType });
  const previous = gl.getRenderTarget();
  gl.shadowMap.needsUpdate = true;
  gl.setRenderTarget(offscreen);
  gl.render(scene, camera);
  if (toScreen) {
    gl.setRenderTarget(null);
    gl.render(scene, camera);
  }
  gl.setRenderTarget(previous);
  offscreen.dispose();
  for (const step of undo.reverse()) step();
  gl.shadowMap.needsUpdate = true;
}

/**
 * Compiles every shader the scene needs before its first frame, without
 * blocking the page. The render loop is held (see `ContinuaScene`'s
 * `frameloop`) while the driver compiles in parallel
 * (`KHR_parallel_shader_compile`, through three's `compileAsync`), so the
 * loading overlay keeps animating and the first drawn frame does not stall for
 * seconds. It replaces drei's `<Preload all />`, which compiled the same ~100
 * programs synchronously and then rendered the whole scene six more times into
 * a cube map to warm textures - and this scene has no textures.
 */
function Precompile({ onCompiled, toScreen }: { onCompiled: () => void; toScreen: boolean }) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  useLayoutEffect(() => {
    let cancelled = false;
    performance.mark('continua:compile-start');
    // Things that are hidden until a handoff or a toggle still need their
    // programs; compiling them now saves a stall the first time they appear.
    // compile() inside compileAsync is synchronous, so they are visible only
    // for the length of this effect.
    const hidden: Object3D[] = [];
    scene.traverse((object) => {
      if (!object.visible) {
        hidden.push(object);
        object.visible = true;
      }
    });
    // A program depends on where it draws. Into a render target - the high
    // tier's post-processing, the rover camera - it outputs linear colour
    // without tone mapping; onto the canvas it does both. Compile the variants
    // the frames will use, or the first frame compiles them again, all at
    // once, on the main thread.
    const offscreen = new WebGLRenderTarget(1, 1, { type: HalfFloatType });
    const previous = gl.getRenderTarget();
    gl.setRenderTarget(offscreen);
    const pending: Promise<unknown>[] = [gl.compileAsync(scene, camera)];
    gl.setRenderTarget(previous);
    offscreen.dispose();
    if (toScreen) pending.push(gl.compileAsync(scene, camera));
    for (const object of hidden) object.visible = false;

    let settled = false;
    const release = () => {
      if (settled) return;
      settled = true;
      performance.mark('continua:compile-end');
      if (cancelled) return;
      warmUp(gl, scene, camera, toScreen);
      performance.mark('continua:warm-end');
      onCompiled();
    };
    Promise.all(pending).then(release, release);
    // compileAsync polls each program from a timer and never settles if one of
    // its materials is disposed meanwhile; the loop must not wait on it forever.
    const fallback = setTimeout(release, 8000);
    return () => {
      cancelled = true;
      clearTimeout(fallback);
    };
  }, [gl, scene, camera, onCompiled, toScreen]);
  return null;
}

/**
 * Steps the quality tier down once if the frame rate stays low - the machine
 * showing this is not the one it was built on. Off for capture, where a harness
 * steps frames and "frames per second" means nothing.
 */
function QualityGovernor() {
  const settings = useSceneSettings();
  const setSettings = useSetSceneSettings();
  const stepped = useRef(false);
  return (
    <PerformanceMonitor
      ms={400}
      iterations={8}
      bounds={(refresh) => [Math.min(45, refresh * 0.75), refresh + 30]}
      flipflops={2}
      onDecline={() => {
        if (stepped.current) return;
        const next = settings.quality === 'high' ? 'balanced' : settings.quality === 'balanced' ? 'low' : null;
        if (!next) return;
        stepped.current = true;
        lowerCeiling(next);
        setSettings({ quality: next });
      }}
    />
  );
}

function SceneContents({
  quality,
  onFirstFrame,
  onCompiled,
  adaptive,
}: {
  quality: QualityTier;
  onFirstFrame?: () => void;
  onCompiled: () => void;
  adaptive: boolean;
}) {
  const settings = useSceneSettings();
  const setSettings = useSetSceneSettings();
  const inspect = settings.mode === 'inspect';

  const onSelectSite = useCallback(
    (id: string) => setSettings({ selectedSiteId: settings.selectedSiteId === id ? null : id }),
    [setSettings, settings.selectedSiteId],
  );

  return (
    <>
      <SceneDriver frozen={inspect} />
      <Lighting quality={quality} />
      <Ground quality={quality} />
      <Mountains quality={quality} />
      <Sea quality={quality} />
      {quality !== 'low' && <RoadsideScatter quality={quality} />}
      <WorldProps
        showMarkers={settings.showMarkers && !inspect}
        selectedSiteId={settings.selectedSiteId}
        onSelectSite={onSelectSite}
        lite={quality === 'low'}
        deadZones={settings.deadZones}
      />
      <DeadZoneWalls zones={settings.deadZones} lite={quality === 'low'} />
      <Rover lod={quality === 'low'} />
      <CoverageOverlay visible={settings.showCoverage && !inspect} />
      {!inspect && <LinkBeams />}
      <SceneCameras
        mode={inspect ? 'turntable' : settings.camera}
        story={settings.storyShot}
        inset={settings.viewInset}
        zones={settings.deadZones}
        flights={settings.linkFlights}
        pace={settings.flightPace}
      />
      {quality === 'low' && <BakeShadows />}
      {quality === 'high' && <PostEffects />}
      {adaptive && <QualityGovernor />}
      <RoverCam quality={quality} />
      <Precompile onCompiled={onCompiled} toScreen={quality !== 'high'} />
      <FirstFrameSignal onFirstFrame={onFirstFrame} />
      <DebugBridge />
    </>
  );
}

export interface ContinuaSceneProps {
  className?: string;
  /** Rendered inside the canvas' Suspense boundary. */
  fallback?: ReactNode;
  /** Canvas created - WebGL is alive, but assets may still be loading. */
  onReady?: () => void;
  /** Assets resolved and the scene has drawn. Use this to hide a loader. */
  onFirstFrame?: () => void;
  /**
   * Step quality down if the frame rate stays low (default). Off for frame-
   * stepped capture, where the measured rate is the harness's, not the GPU's.
   */
  adaptive?: boolean;
  /**
   * Draw frames (default). False holds the render loop: the app's shared
   * canvas while no page is showing it.
   */
  active?: boolean;
}

/**
 * Whether the context is drawn by a software rasteriser - SwiftShader (headless
 * Chrome, and Chrome with a blocklisted GPU), llvmpipe / softpipe (Mesa without
 * a GPU), or the Microsoft Basic Render Driver (a VM or remote desktop). The
 * high tier's 4096-texel shadow map and full-resolution procedural ground cost
 * about a second a frame there.
 */
function isSoftwareRenderer(context: WebGLRenderingContext | WebGL2RenderingContext): boolean {
  try {
    const info = context.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(context.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : context.RENDERER));
    return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer);
  } catch {
    return false;
  }
}

let softwareProbe: boolean | null = null;

const TIERS: readonly QualityTier[] = ['low', 'balanced', 'high'];
let ceiling: QualityTier = 'high';

function lowerCeiling(tier: QualityTier): void {
  if (TIERS.indexOf(tier) < TIERS.indexOf(ceiling)) ceiling = tier;
}

/**
 * Asked once, on a throwaway context, *before* the scene's canvas exists:
 * multisampling can only be chosen when a context is created, and on a
 * software rasteriser a 4x MSAA buffer at full resolution costs more per frame
 * than the whole scene does.
 */
function probeSoftwareRenderer(): boolean {
  if (softwareProbe !== null) return softwareProbe;
  softwareProbe = false;
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (context) {
      softwareProbe = isSoftwareRenderer(context);
      context.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    softwareProbe = false;
  }
  return softwareProbe;
}

/**
 * The highest quality tier this device has shown it can hold: lowered for good
 * by a software rasteriser or by the frame-rate governor. A page that brings
 * its own settings to the app's shared canvas starts at or below it, so moving
 * between pages cannot put a struggling machine back on the high tier.
 */
export function qualityCeiling(): QualityTier {
  if (probeSoftwareRenderer()) lowerCeiling('low');
  return ceiling;
}

export function ContinuaScene({
  className,
  fallback,
  onReady,
  onFirstFrame,
  adaptive = true,
  active = true,
}: ContinuaSceneProps) {
  const settings = useSceneSettings();
  const setSettings = useSetSceneSettings();
  const [software] = useState(probeSoftwareRenderer);
  // The loop starts once every program is compiled, and runs only while the
  // canvas is on screen. Passed to the canvas as a prop rather than set from
  // inside it: the canvas re-applies its props on every render, so a loop held
  // from inside would be released again by any unrelated re-render.
  const [compiled, setCompiled] = useState(false);
  const onCompiled = useCallback(() => setCompiled(true), []);
  // Adapt to the device before the first frame rather than after a stutter.
  const [pixelRatioCap] = useState(() => {
    if (typeof window === 'undefined') return 2;
    const cores = navigator.hardwareConcurrency ?? 4;
    const dpr = window.devicePixelRatio ?? 1;
    return cores <= 4 || dpr > 2.5 ? 1.5 : 2;
  });

  const dpr = useMemo<number | [number, number]>(() => {
    // A software rasteriser pays for every pixel on the CPU.
    if (software) return 0.5;
    if (settings.quality === 'low') return 0.75;
    if (settings.quality === 'balanced') return [0.9, Math.min(1.5, pixelRatioCap)];
    return [1, pixelRatioCap];
  }, [software, settings.quality, pixelRatioCap]);

  return (
    <Canvas
      className={className}
      frameloop={compiled && active ? 'always' : 'never'}
      dpr={dpr}
      shadows={settings.quality === 'low' ? false : { enabled: true, type: PCFShadowMap }}
      gl={{
        antialias: !software && settings.quality !== 'low',
        powerPreference: 'high-performance',
        alpha: false,
        preserveDrawingBuffer: true,
      }}
      camera={{ position: [18, 7, 18], fov: 40, near: 0.3, far: 2600 }}
      onCreated={({ gl, scene }) => {
        // Khronos PBR Neutral: whites stay white and hues stay where the
        // palette put them - ACES pushed the pale sand toward grey-orange.
        gl.toneMapping = NeutralToneMapping;
        gl.toneMappingExposure = 0.92;
        gl.outputColorSpace = SRGBColorSpace;
        scene.background = null;
        performance.mark('continua:canvas');
        // Start a software-rendered context on the low tier rather than at one
        // frame a second. Only the starting point: the quality control still
        // lets the viewer choose any tier.
        if (software || isSoftwareRenderer(gl.getContext())) {
          lowerCeiling('low');
          if (settings.quality !== 'low') setSettings({ quality: 'low' });
        }
        onReady?.();
      }}
      style={{ background: SCENE_COLOR.skyHorizon }}
    >
      <Suspense fallback={fallback ?? null}>
        <SceneContents
          quality={settings.quality}
          onFirstFrame={onFirstFrame}
          onCompiled={onCompiled}
          adaptive={adaptive}
        />
      </Suspense>
      <AdaptiveDpr pixelated={false} />
      <AdaptiveEvents />
    </Canvas>
  );
}
