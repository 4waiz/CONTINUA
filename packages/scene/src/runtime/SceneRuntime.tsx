'use client';

/**
 * Scene runtime: the clock, the state source and the view settings.
 *
 * Settings live in a tiny external store read through `useSyncExternalStore`,
 * so toggling a camera re-renders the controls but never the render loop, and
 * the render loop itself never triggers a React update. That separation is what
 * keeps the scene at frame rate.
 */

import type {
  CameraMode,
  QualityTier,
  SceneMode,
  SceneState,
  SceneStateSource,
} from '@continua/contracts';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { SceneClock } from '../core/clock';
import { previewSource } from '../preview/previewSource';

export interface SceneSettings {
  mode: SceneMode;
  camera: CameraMode;
  quality: QualityTier;
  showCoverage: boolean;
  showRoute: boolean;
  showMarkers: boolean;
  selectedSiteId: string | null;
}

const DEFAULT_SETTINGS: SceneSettings = {
  mode: 'mission',
  camera: 'follow',
  quality: 'high',
  showCoverage: false,
  showRoute: true,
  showMarkers: true,
  selectedSiteId: null,
};

class SettingsStore {
  private settings: SceneSettings = DEFAULT_SETTINGS;
  private readonly listeners = new Set<() => void>();

  get = (): SceneSettings => this.settings;

  set = (patch: Partial<SceneSettings>): void => {
    let changed = false;
    for (const key of Object.keys(patch) as (keyof SceneSettings)[]) {
      if (patch[key] !== undefined && this.settings[key] !== patch[key]) changed = true;
    }
    if (!changed) return;
    this.settings = { ...this.settings, ...patch };
    for (const listener of this.listeners) listener();
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}

export interface SceneRuntime {
  readonly clock: SceneClock;
  readonly source: SceneStateSource;
  readonly settings: SettingsStore;
  /**
   * Scratch state, rewritten in place every frame by the scene root and read by
   * everything else. Never put this in React state.
   */
  readonly frame: { current: SceneState };
}

const RuntimeContext = createContext<SceneRuntime | null>(null);

export function SceneRuntimeProvider({
  children,
  source = previewSource,
}: {
  children: ReactNode;
  source?: SceneStateSource;
}) {
  const runtime = useMemo<SceneRuntime>(() => {
    const clock = new SceneClock(source.duration, { loop: true });
    return {
      clock,
      source,
      settings: new SettingsStore(),
      frame: { current: source.sampleAt(0) },
    };
  }, [source]);

  // A stable handle for browser smoke tests and, in Phase 3, the offline
  // capture harness. Read-only preview data; nothing sensitive crosses here.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    (window as unknown as { __CONTINUA__?: unknown }).__CONTINUA__ = {
      clock: runtime.clock,
      source: runtime.source,
      settings: runtime.settings,
      getFrame: () => runtime.frame.current,
      version: 'phase-1',
    };
    return () => {
      delete (window as unknown as { __CONTINUA__?: unknown }).__CONTINUA__;
    };
  }, [runtime]);

  return <RuntimeContext.Provider value={runtime}>{children}</RuntimeContext.Provider>;
}

export function useSceneRuntime(): SceneRuntime {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error('useSceneRuntime must be used inside <SceneRuntimeProvider>');
  return runtime;
}

export function useSceneSettings(): SceneSettings {
  const { settings } = useSceneRuntime();
  return useSyncExternalStore(settings.subscribe, settings.get, settings.get);
}

export function useSetSceneSettings(): (patch: Partial<SceneSettings>) => void {
  return useSceneRuntime().settings.set;
}

/** Playback transport state. Updates only on play/pause/seek/speed, not per frame. */
export function usePlayback() {
  const { clock } = useSceneRuntime();
  const cache = useRef(clock.state);
  return useSyncExternalStore(
    (listener) => clock.subscribe(() => listener()),
    () => {
      const next = clock.state;
      const previous = cache.current;
      if (
        next.playing !== previous.playing ||
        next.speed !== previous.speed ||
        Math.abs(next.simTime - previous.simTime) > 1e-6
      ) {
        cache.current = next;
      }
      return cache.current;
    },
    () => cache.current,
  );
}

/**
 * A throttled read of scene state for HUD widgets.
 *
 * Deliberately polls at a low rate instead of subscribing per frame: numbers a
 * human reads do not need 60 updates a second, and React should not do 60
 * renders a second.
 */
export function useThrottledSceneState(intervalMs = 200): SceneState {
  const { frame, clock, source } = useSceneRuntime();
  const cache = useRef<SceneState>(frame.current);
  const version = useRef(0);

  const subscribe = useMemo(
    () => (listener: () => void) => {
      const timer = setInterval(() => {
        const next = frame.current;
        if (next !== cache.current) {
          cache.current = next;
          version.current += 1;
          listener();
        }
      }, intervalMs);
      const unsubscribe = clock.subscribe(() => {
        cache.current = source.sampleAt(clock.time);
        version.current += 1;
        listener();
      });
      return () => {
        clearInterval(timer);
        unsubscribe();
      };
    },
    [frame, clock, source, intervalMs],
  );

  return useSyncExternalStore(
    subscribe,
    () => cache.current,
    () => cache.current,
  );
}

/** Keyboard transport, matching the on-screen controls. */
export function useSceneKeyboard(): void {
  const { clock, settings } = useSceneRuntime();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      switch (event.key) {
        case ' ':
          event.preventDefault();
          clock.toggle();
          break;
        case 'r':
        case 'R':
          clock.reset();
          break;
        case 'ArrowLeft':
          clock.setTime(clock.time - (event.shiftKey ? 10 : 2));
          break;
        case 'ArrowRight':
          clock.setTime(clock.time + (event.shiftKey ? 10 : 2));
          break;
        case 'c':
        case 'C':
          settings.set({ showCoverage: !settings.get().showCoverage });
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clock, settings]);
}
