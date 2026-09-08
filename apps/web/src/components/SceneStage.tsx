'use client';

/**
 * The frame around the 3D scene: capability check, loading, and failure.
 *
 * A WebGL app that shows a blank rectangle when something goes wrong is worse
 * than one that says what happened, so all three states are explicit here.
 */

import { ContinuaScene } from '@continua/scene';
import { useProgress } from '@react-three/drei';
import { Component, useCallback, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';

// ---------------------------------------------------------------------------

function detectWebGL(): { ok: true } | { ok: false; reason: string } {
  if (typeof window === 'undefined') return { ok: false, reason: 'Rendering on the server.' };
  try {
    const canvas = document.createElement('canvas');
    const context =
      canvas.getContext('webgl2') ??
      canvas.getContext('webgl') ??
      canvas.getContext('experimental-webgl');
    if (!context) {
      return {
        ok: false,
        reason:
          'This browser reports no WebGL context. Enable hardware acceleration, or try a recent Chrome, Edge, Firefox or Safari.',
      };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'WebGL check failed.' };
  }
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

  return (
    <div
      className="pointer-events-none absolute inset-0 grid place-items-center transition-opacity duration-300"
      style={{
        background: 'linear-gradient(180deg,#FBFCFE 0%,#EEF3FD 100%)',
        opacity: ready ? 0 : 1,
      }}
    >
      <div className="w-64 text-center">
        <div className="panel-label mb-3">Loading mission scene</div>
        <div className="loading-sweep relative h-[5px] w-full overflow-hidden rounded-full bg-[color:var(--color-line)]">
          <div
            className="h-full rounded-full bg-[color:var(--color-blue)] transition-[width] duration-200"
            style={{ width: `${Math.max(6, progress)}%` }}
          />
        </div>
        <div className="metric mt-2 font-[family-name:var(--font-mono)] text-[11px] text-[color:var(--color-muted)]">
          {ready ? 'ready' : `${Math.round(progress)}%`}
          {!ready && item ? ` · ${item.split('/').pop()}` : ''}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function SceneStage({ className = '' }: { className?: string }) {
  // This component is only ever mounted client-side (`ssr: false`), so the
  // capability probe can run during the first render instead of scheduling a
  // second one from an effect.
  const [support] = useState(detectWebGL);
  const [contextLost, setContextLost] = useState(false);
  const [ready, setReady] = useState(false);
  const onFirstFrame = useCallback(() => setReady(true), []);

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
          <ContinuaScene className="!absolute inset-0" onFirstFrame={onFirstFrame} />
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
}
