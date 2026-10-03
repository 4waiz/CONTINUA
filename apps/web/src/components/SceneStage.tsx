'use client';

/**
 * The frame around the 3D scene: capability check, loading, and failure.
 *
 * A scene page's stage normally draws on the app's one shared canvas (see
 * `sceneHostStore`): it lends the canvas a box and names the runtime to draw.
 * Capture draws on a canvas of its own (`inline`).
 */

import { ContinuaScene, qualityCeiling, useSceneRuntime } from '@continua/scene';
import { useProgress } from '@react-three/drei';
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { attachSceneCanvas, showSceneRuntime, useSceneHost } from './sceneHostStore';
import { SceneErrorBoundary, StatusPane } from './SceneStatus';

// ---------------------------------------------------------------------------

type WebGLSupport = { ok: true } | { ok: false; reason: string };
let webglSupport: WebGLSupport | null = null;

/**
 * Asked once per page load, and the probe context is released at once. It
 * used to run on every scene mount and keep its context: a browser allows
 * about sixteen, and when the limit is reached it drops the *oldest* - which
 * after enough page switches is the scene's own.
 */
function detectWebGL(): WebGLSupport {
  if (typeof window === 'undefined') return { ok: false, reason: 'Rendering on the server.' };
  if (webglSupport) return webglSupport;
  try {
    const canvas = document.createElement('canvas');
    const context = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (!context) {
      webglSupport = {
        ok: false,
        reason:
          'This browser reports no WebGL context. Enable hardware acceleration, or try a recent Chrome, Edge, Firefox or Safari.',
      };
    } else {
      context.getExtension('WEBGL_lose_context')?.loseContext();
      webglSupport = { ok: true };
    }
  } catch (error) {
    webglSupport = { ok: false, reason: error instanceof Error ? error.message : 'WebGL check failed.' };
  }
  return webglSupport;
}

// ---------------------------------------------------------------------------

const LOADER_LINKS = [
  { id: 'wired', color: '#12B9E8' },
  { id: 'wifi', color: '#12B9E8' },
  { id: 'cellular', color: '#176BFF' },
  { id: 'satellite', color: '#7C3CFF' },
] as const;

function LoadingOverlay({ ready }: { ready: boolean }) {
  const { progress, item } = useProgress();
  const [settled, setSettled] = useState(false);

  // `ready` is the scene's own first-frame signal. `useProgress` only drives
  // the bar: its counters can sit at zero when glTFs come from the preload
  // cache, so it must never be the thing that decides we are done.
  useEffect(() => {
    if (!ready) return undefined;
    const timer = setTimeout(() => setSettled(true), 240);
    return () => clearTimeout(timer);
  }, [ready]);

  if (settled) return null;
  const shown = ready ? 100 : Math.max(6, progress);

  return (
    <div
      className="pointer-events-none absolute inset-0 grid place-items-center transition-opacity duration-300"
      style={{
        background: 'radial-gradient(120% 90% at 50% 40%, #FFFFFF 0%, #F3F7FD 55%, #E9F0FA 100%)',
        opacity: ready ? 0 : 1,
      }}
    >
      <div className="w-[300px] text-center">
        <div
          className="text-[30px] font-semibold tracking-[0.12em]"
          style={{
            background: 'linear-gradient(96deg,#12B9E8,#176BFF 45%,#7C3CFF)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent',
          }}
        >
          CONTINUA
        </div>
        <div className="mt-1 text-[12px] text-[color:var(--color-muted)]">
          The network changes. The session doesn&apos;t.
        </div>
        {/* The four links light up as the world arrives - alternatives to one
            gateway, so they sit side by side, never in a chain. */}
        <div className="mt-6 flex items-center justify-center gap-3" aria-hidden>
          {LOADER_LINKS.map((link, index) => {
            const lit = shown >= (index + 1) * 22;
            return (
              <span
                key={link.id}
                className="h-2 w-8 rounded-full transition-all duration-500"
                style={{ background: lit ? link.color : 'var(--color-line)', opacity: lit ? 1 : 0.7 }}
              />
            );
          })}
        </div>
        <div className="mt-4 h-[3px] w-full overflow-hidden rounded-full bg-[color:var(--color-line)]">
          <div
            className="h-full rounded-full transition-[width] duration-300"
            style={{ width: `${shown}%`, background: 'linear-gradient(90deg,#12B9E8,#176BFF,#7C3CFF)' }}
          />
        </div>
        <div className="panel-label mt-3">Loading mission scene</div>
        <div className="metric mt-1 font-[family-name:var(--font-mono)] text-[11px] text-[color:var(--color-faint)]">
          {ready ? 'ready' : progress >= 100 ? 'preparing shaders' : `${Math.round(progress)}%`}
          {!ready && progress < 100 && item ? ` · ${item.split('/').pop()?.split('?')[0]}` : ''}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

interface StageProps {
  className?: string;
  /**
   * Called once, when the scene has loaded its models and drawn its first
   * frames - the moment a screenshot of it shows the world rather than the
   * loading overlay.
   */
  onReady?: () => void;
  /** Let the scene step its quality down on a slow machine; off for capture. */
  adaptive?: boolean;
  /**
   * Draw on a canvas of this stage's own rather than the app's shared one.
   * Capture does: its frame is a fixed 16:9 box that must share nothing.
   */
  inline?: boolean;
}

const TIER_RANK = { low: 0, balanced: 1, high: 2 } as const;

function useContextLost(): boolean {
  const [lost, setLost] = useState(false);
  useEffect(() => {
    const onLost = (event: Event) => {
      event.preventDefault();
      setLost(true);
    };
    const onRestored = () => setLost(false);
    window.addEventListener('webglcontextlost', onLost, true);
    window.addEventListener('webglcontextrestored', onRestored, true);
    return () => {
      window.removeEventListener('webglcontextlost', onLost, true);
      window.removeEventListener('webglcontextrestored', onRestored, true);
    };
  }, []);
  return lost;
}

function Unsupported({ reason }: { reason: string }) {
  return (
    <StatusPane
      tone="bad"
      title="WebGL is not available"
      body={reason}
      detail="The rest of the dashboard still works; only the 3D view needs WebGL."
    />
  );
}

function ContextLost() {
  return (
    <StatusPane
      tone="bad"
      title="Graphics context lost"
      body="The browser released the WebGL context, usually after a GPU reset or a long background tab."
      detail="Reload the page to restore the scene."
    />
  );
}

export const SceneStage = memo(function SceneStage(props: StageProps) {
  return props.inline ? <InlineStage {...props} /> : <HostedStage {...props} />;
});

/**
 * On the shared canvas. The loader shows until that canvas has first drawn -
 * on the first scene page of the visit; after that, a scene page opens on a
 * live scene at once.
 */
function HostedStage({ className = '', onReady }: StageProps) {
  // Only ever mounted client-side (`ssr: false`), so the capability probe can
  // run during the first render instead of scheduling a second one.
  const [support] = useState(detectWebGL);
  const contextLost = useContextLost();
  const runtime = useSceneRuntime();
  const { drawn } = useSceneHost();
  const slotRef = useRef<HTMLDivElement>(null);
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  // Hold the canvas for as long as this page is open...
  useLayoutEffect(() => {
    const slot = slotRef.current;
    if (!support.ok || !slot) return undefined;
    performance.mark('continua:stage-mount');
    return attachSceneCanvas(slot);
  }, [support.ok]);

  // ...and draw this page's runtime on it, again whenever that changes (a run
  // starting swaps the source). The page starts at or below the quality the
  // device has already shown it can hold.
  useLayoutEffect(() => {
    const slot = slotRef.current;
    if (!support.ok || !slot) return;
    const ceiling = qualityCeiling();
    if (TIER_RANK[runtime.settings.get().quality] > TIER_RANK[ceiling]) runtime.settings.set({ quality: ceiling });
    showSceneRuntime(slot, runtime);
  }, [runtime, support.ok]);

  useEffect(() => {
    if (drawn) onReadyRef.current?.();
  }, [drawn]);

  return (
    <div className={`scene-shell ${className}`}>
      {support.ok === false && <Unsupported reason={support.reason} />}
      {support.ok === true && (
        <>
          <div ref={slotRef} className="absolute inset-0" />
          <LoadingOverlay ready={drawn} />
        </>
      )}
      {contextLost && <ContextLost />}
    </div>
  );
}

/** A canvas of its own, created with the stage and destroyed with it. */
function InlineStage({ className = '', onReady, adaptive = true }: StageProps) {
  const [support] = useState(detectWebGL);
  const contextLost = useContextLost();
  const [ready, setReady] = useState(false);
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);
  const onFirstFrame = useCallback(() => {
    setReady(true);
    onReadyRef.current?.();
  }, []);

  useEffect(() => {
    performance.mark('continua:stage-mount');
  }, []);

  return (
    <div className={`scene-shell ${className}`}>
      {support.ok === false && <Unsupported reason={support.reason} />}
      {support.ok === true && (
        <SceneErrorBoundary>
          <ContinuaScene className="!absolute inset-0" onFirstFrame={onFirstFrame} adaptive={adaptive} />
          <LoadingOverlay ready={ready} />
        </SceneErrorBoundary>
      )}
      {contextLost && <ContextLost />}
    </div>
  );
}
