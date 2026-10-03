'use client';

/**
 * The frame around the 3D scene: capability check, loading, and failure.
 *
 * A WebGL app that shows a blank rectangle when something goes wrong is worse
 * than one that says what happened, so all three states are explicit here.
 */

import { ContinuaScene } from '@continua/scene';
import { useProgress } from '@react-three/drei';
import { Component, memo, useCallback, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react';

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

interface BoundaryState {
  error: Error | null;
}

class SceneErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[CONTINUA] scene failed to render', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <StatusPane
          tone="bad"
          title="The scene could not be rendered"
          body={this.state.error.message}
          detail="Assets are served from /models. If they are missing, run `npm run blender:all` to regenerate them."
        />
      );
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------

function StatusPane({
  tone,
  title,
  body,
  detail,
}: {
  tone: 'bad' | 'muted';
  title: string;
  body: string;
  detail?: string;
}) {
  return (
    <div className="absolute inset-0 grid place-items-center p-8">
      <div className="max-w-md text-center">
        <div
          className="panel-label mb-2"
          style={{ color: tone === 'bad' ? 'var(--color-bad)' : 'var(--color-muted)' }}
        >
          {tone === 'bad' ? 'Scene unavailable' : 'Status'}
        </div>
        <h3 className="text-[17px] font-semibold text-[color:var(--color-ink)]">{title}</h3>
        <p className="mt-2 text-[13px] leading-relaxed text-[color:var(--color-muted)]">{body}</p>
        {detail && (
          <p className="mt-3 font-[family-name:var(--font-mono)] text-[11.5px] text-[color:var(--color-muted)]">
            {detail}
          </p>
        )}
      </div>
    </div>
  );
}

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

/**
 * @param onReady  called once, when the scene has loaded its models and drawn
 *   its first frames - the moment a screenshot of it shows the world rather
 *   than the loading overlay.
 */
export const SceneStage = memo(function SceneStage({
  className = '',
  onReady,
  adaptive = true,
}: {
  className?: string;
  onReady?: () => void;
  /** Let the scene step its quality down on a slow machine; off for capture. */
  adaptive?: boolean;
}) {
  // This component is only ever mounted client-side (`ssr: false`), so the
  // capability probe can run during the first render instead of scheduling a
  // second one from an effect.
  const [support] = useState(detectWebGL);
  const [contextLost, setContextLost] = useState(false);
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

  useEffect(() => {
    const onLost = (event: Event) => {
      event.preventDefault();
      setContextLost(true);
    };
    const onRestored = () => setContextLost(false);
    window.addEventListener('webglcontextlost', onLost, true);
    window.addEventListener('webglcontextrestored', onRestored, true);
    return () => {
      window.removeEventListener('webglcontextlost', onLost, true);
      window.removeEventListener('webglcontextrestored', onRestored, true);
    };
  }, []);

  return (
    <div className={`scene-shell ${className}`}>
      {support.ok === false && (
        <StatusPane
          tone="bad"
          title="WebGL is not available"
          body={support.reason}
          detail="The rest of the dashboard still works; only the 3D view needs WebGL."
        />
      )}

      {support.ok === true && (
        <SceneErrorBoundary>
          <ContinuaScene className="!absolute inset-0" onFirstFrame={onFirstFrame} adaptive={adaptive} />
          <LoadingOverlay ready={ready} />
        </SceneErrorBoundary>
      )}

      {contextLost && (
        <StatusPane
          tone="bad"
          title="Graphics context lost"
          body="The browser released the WebGL context, usually after a GPU reset or a long background tab."
          detail="Reload the page to restore the scene."
        />
      )}
    </div>
  );
});
