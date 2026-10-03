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
import { NeutralToneMapping, PCFShadowMap, SRGBColorSpace, type Object3D } from 'three';
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
import { Lighting } from './Lighting';
import { PostEffects } from './PostEffects';
import { CoverageOverlay, LinkBeams } from './Network';
import { Rover } from './Rover';
import { SceneCameras } from './Cameras';
import { WorldProps } from './WorldProps';

/** Sim time used by inspect mode: inside the dock dwell, so the rover is parked. */
const INSPECT_TIME = 2.5;

/**
 * Advances the clock and publishes this frame's state before anything else
 * reads it. Registered at priority -1 so it always runs first.
 */
function SceneDriver({ frozen }: { frozen: boolean }) {
  const { clock, source, frame } = useSceneRuntime();
  useFrame((_, delta) => {
    clock.advance(delta);
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
  return null;
}

/**
 * Compiles every shader the scene needs before its first frame, without
 * blocking the page. The render loop is held while the driver compiles in
 * parallel (`KHR_parallel_shader_compile`, through three's `compileAsync`), so
 * the loading overlay keeps animating and the first drawn frame does not stall
 * for seconds. It replaces drei's `<Preload all />`, which compiled the same
 * ~100 programs synchronously and then rendered the whole scene six more times
 * into a cube map to warm textures - and this scene has no textures.
 */
function Precompile() {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const setFrameloop = useThree((state) => state.setFrameloop);
  useLayoutEffect(() => {
    let cancelled = false;
    // Things that are hidden until a handoff or a toggle still need their
    // programs; compiling them now saves a stall the first time they appear.
    const hidden: Object3D[] = [];
    scene.traverse((object) => {
      if (!object.visible) {
        hidden.push(object);
        object.visible = true;
      }
    });
    setFrameloop('never');
    performance.mark('continua:compile-start');
    const release = () => {
      performance.mark('continua:compile-end');
      for (const object of hidden) object.visible = false;
      if (!cancelled) setFrameloop('always');
    };
    gl.compileAsync(scene, camera).then(release, release);
    return () => {
      cancelled = true;
      setFrameloop('always');
    };
  }, [gl, scene, camera, setFrameloop]);
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
        setSettings({ quality: next });
      }}
    />
  );
}

function SceneContents({
  quality,
  onFirstFrame,
  adaptive,
}: {
  quality: QualityTier;
  onFirstFrame?: () => void;
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
      <WorldProps
        showMarkers={settings.showMarkers && !inspect}
        selectedSiteId={settings.selectedSiteId}
        onSelectSite={onSelectSite}
      />
      <Rover lod={quality === 'low'} />
      <CoverageOverlay visible={settings.showCoverage && !inspect} />
      {!inspect && <LinkBeams />}
      <SceneCameras mode={inspect ? 'turntable' : settings.camera} />
      {quality === 'low' && <BakeShadows />}
      {quality === 'high' && <PostEffects />}
      {adaptive && <QualityGovernor />}
      <Precompile />
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

export function ContinuaScene({ className, fallback, onReady, onFirstFrame, adaptive = true }: ContinuaSceneProps) {
  const settings = useSceneSettings();
  const setSettings = useSetSceneSettings();
  const [software] = useState(probeSoftwareRenderer);
  // Adapt to the device before the first frame rather than after a stutter.
  const [pixelRatioCap] = useState(() => {
    if (typeof window === 'undefined') return 2;
    const cores = navigator.hardwareConcurrency ?? 4;
    const dpr = window.devicePixelRatio ?? 1;
    return cores <= 4 || dpr > 2.5 ? 1.5 : 2;
  });

  const dpr = useMemo<number | [number, number]>(() => {
    // A software rasteriser pays for every pixel on the CPU.
    if (software) return 0.6;
    if (settings.quality === 'low') return 0.75;
    if (settings.quality === 'balanced') return [0.9, Math.min(1.5, pixelRatioCap)];
    return [1, pixelRatioCap];
  }, [software, settings.quality, pixelRatioCap]);

  return (
    <Canvas
      className={className}
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
        if (settings.quality !== 'low' && (software || isSoftwareRenderer(gl.getContext()))) {
          setSettings({ quality: 'low' });
        }
        onReady?.();
      }}
      style={{ background: SCENE_COLOR.skyHorizon }}
    >
      <Suspense fallback={fallback ?? null}>
        <SceneContents quality={settings.quality} onFirstFrame={onFirstFrame} adaptive={adaptive} />
      </Suspense>
      <AdaptiveDpr pixelated={false} />
      <AdaptiveEvents />
    </Canvas>
  );
}
