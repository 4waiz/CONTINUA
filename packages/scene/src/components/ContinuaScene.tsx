'use client';

/**
 * The composed CONTINUA scene.
 *
 * Deliberately independent of the page it sits on: `/scene-lab`, the dashboard
 * frame on the landing page and (in Phase 3) the offline capture harness all
 * mount this same component.
 */

import { AdaptiveDpr, AdaptiveEvents, BakeShadows, Preload } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ACESFilmicToneMapping, PCFShadowMap, SRGBColorSpace } from 'three';
import type { QualityTier } from '@continua/contracts';
import { useFrame, useThree } from '@react-three/fiber';
import { SCENE_COLOR } from '../theme';
import {
  useSceneRuntime,
  useSceneSettings,
  useSetSceneSettings,
} from '../runtime/SceneRuntime';
import { Ground } from './Ground';
import { Lighting } from './Lighting';
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
 * glTF has resolved — which makes it a far more trustworthy "ready" signal than
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
      onFirstFrame?.();
    }
  });
  return null;
}

/**
 * Publishes the live renderer state on `window.__CONTINUA__.three`.
 *
 * The browser smoke tests need to walk the real scene graph to prove the
 * exported rig survived — node names, materials, triangle counts. There is no
 * supported way to reach it from outside the Canvas, so the scene hands it out
 * explicitly. Preview data only.
 */
function DebugBridge() {
  const scene = useThree((state) => state.scene);
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const api = (window as unknown as { __CONTINUA__?: Record<string, unknown> }).__CONTINUA__;
    if (!api) return;
    api.three = { scene, gl, camera };
    return () => {
      delete api.three;
    };
  }, [scene, gl, camera]);
  return null;
}

function SceneContents({
  quality,
  onFirstFrame,
}: {
  quality: QualityTier;
  onFirstFrame?: () => void;
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
      <Preload all />
      <FirstFrameSignal onFirstFrame={onFirstFrame} />
      <DebugBridge />
    </>
  );
}

export interface ContinuaSceneProps {
  className?: string;
  /** Rendered inside the canvas' Suspense boundary. */
  fallback?: ReactNode;
  /** Canvas created — WebGL is alive, but assets may still be loading. */
  onReady?: () => void;
  /** Assets resolved and the scene has drawn. Use this to hide a loader. */
  onFirstFrame?: () => void;
}

export function ContinuaScene({ className, fallback, onReady, onFirstFrame }: ContinuaSceneProps) {
  const settings = useSceneSettings();
  // Adapt to the device before the first frame rather than after a stutter.
  const [pixelRatioCap] = useState(() => {
    if (typeof window === 'undefined') return 2;
    const cores = navigator.hardwareConcurrency ?? 4;
    const dpr = window.devicePixelRatio ?? 1;
    return cores <= 4 || dpr > 2.5 ? 1.5 : 2;
  });

  const dpr = useMemo<[number, number]>(() => {
    if (settings.quality === 'low') return [0.7, 1];
    if (settings.quality === 'balanced') return [0.9, Math.min(1.5, pixelRatioCap)];
    return [1, pixelRatioCap];
  }, [settings.quality, pixelRatioCap]);

  return (
    <Canvas
      className={className}
      dpr={dpr}
      shadows={settings.quality === 'low' ? false : { enabled: true, type: PCFShadowMap }}
      gl={{
        antialias: settings.quality !== 'low',
        powerPreference: 'high-performance',
        alpha: false,
        preserveDrawingBuffer: true,
      }}
      camera={{ position: [18, 7, 18], fov: 40, near: 0.3, far: 2600 }}
      onCreated={({ gl, scene }) => {
        gl.toneMapping = ACESFilmicToneMapping;
        gl.toneMappingExposure = 0.88;
        gl.outputColorSpace = SRGBColorSpace;
        scene.background = null;
        onReady?.();
      }}
      style={{ background: SCENE_COLOR.skyHorizon }}
    >
      <Suspense fallback={fallback ?? null}>
        <SceneContents quality={settings.quality} onFirstFrame={onFirstFrame} />
      </Suspense>
      <AdaptiveDpr pixelated={false} />
      <AdaptiveEvents />
    </Canvas>
  );
}
