'use client';

/**
 * The live connection to one engine run.
 *
 * Responsibilities, in order of how badly each one goes wrong if skipped:
 *
 * 1. **Never invent data.** If the socket drops, the hook reports
 *    `connection: 'disconnected'` and marks the last event stale. It does not
 *    interpolate forward, and it does not synthesise numbers to keep the
 *    dashboard moving.
 * 2. **Survive reconnects.** Events are keyed by their monotonic `seq`;
 *    duplicates from a resubscribe are dropped and gaps are counted, so the UI
 *    can say the history is incomplete rather than pretend it is whole.
 * 3. **Stay off the render path.** Events feed an `EngineSceneStateSource`
 *    (mutable, read inside `useFrame`); React updates are batched on a timer.
 *
 * All per-run buffers live in a single state object tagged with its run id, and
 * the hook *derives* the empty state for a different run rather than clearing
 * state from an effect. That keeps the reset atomic and avoids a render where
 * the new run is showing the old run's history.
 */

import { EngineSceneStateSource } from '@continua/scene';
import {
  parseSocketMessage,
  type EngineEvent,
  type EngineRunState,
} from '@continua/contracts/engine';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { socketUrl } from './api';

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

interface StreamBuffer {
  runId: string | null;
  latest: EngineEvent | null;
  history: EngineEvent[];
  decisions: EngineEvent[];
  dropped: number;
  state: EngineRunState | null;
  connection: ConnectionState;
  error: string | null;
  attempts: number;
}

const EMPTY: StreamBuffer = {
  runId: null,
  latest: null,
  history: [],
  decisions: [],
  dropped: 0,
  state: null,
  connection: 'idle',
  error: null,
  attempts: 0,
};

export interface EngineRunHandle {
  source: EngineSceneStateSource;
  connection: ConnectionState;
  /** True when the last event is older than the staleness threshold. */
  stale: boolean;
  state: EngineRunState | null;
  latest: EngineEvent | null;
  decisions: EngineEvent[];
  history: EngineEvent[];
  droppedSequences: number;
  error: string | null;
  reconnectAttempts: number;
}

const HISTORY_LIMIT = 900;
const DECISION_LIMIT = 200;
const STALE_AFTER_MS = 4000;
const UI_THROTTLE_MS = 180;

export interface EngineRunOptions {
  /**
   * How often buffered events are handed to React. Defaults to 180 ms, which
   * is right for a dashboard a human reads. Frame capture sets it much lower so
   * the on-screen numbers match the frame being rendered rather than lagging a
   * fifth of a second behind it.
   */
  throttleMs?: number;
}

export function useEngineRun(runId: string | null, options: EngineRunOptions = {}): EngineRunHandle {
  const throttleMs = options.throttleMs ?? UI_THROTTLE_MS;
  // One buffer per run: a new run can never inherit the previous timeline.
  const source = useMemo(() => new EngineSceneStateSource(runId ?? 'engine', 100), [runId]);

  const [buffer, setBuffer] = useState<StreamBuffer>(EMPTY);
  const [stale, setStale] = useState(false);

  const pendingRef = useRef<EngineEvent[]>([]);
  const lastSeqRef = useRef(0);
  const lastMessageAtRef = useRef(0);
  const runIdRef = useRef<string | null>(null);

  // Only the buffer whose tag matches the requested run is ever shown.
  const active = buffer.runId === runId ? buffer : EMPTY;

  // --- batched hand-off from the socket to React ----------------------------
  useEffect(() => {
    const timer = setInterval(() => {
      const pending = pendingRef.current;
      if (pending.length === 0) return;
      pendingRef.current = [];
      const tag = runIdRef.current;
      setBuffer((previous) => {
        const base = previous.runId === tag ? previous : { ...EMPTY, runId: tag };
        const history = base.history.concat(pending);
        const acted = pending.filter((event) => event.action && event.action.kind !== 'none');
        const decisions = acted.length ? base.decisions.concat(acted) : base.decisions;
        return {
          ...base,
          latest: pending[pending.length - 1]!,
          history: history.length > HISTORY_LIMIT ? history.slice(history.length - HISTORY_LIMIT) : history,
          decisions:
            decisions.length > DECISION_LIMIT
              ? decisions.slice(decisions.length - DECISION_LIMIT)
              : decisions,
        };
      });
    }, throttleMs);
    return () => clearInterval(timer);
  }, [throttleMs]);

  // --- staleness watchdog ---------------------------------------------------
  useEffect(() => {
    const timer = setInterval(() => {
      if (!lastMessageAtRef.current) return;
      setStale(Date.now() - lastMessageAtRef.current > STALE_AFTER_MS);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // --- socket lifecycle -----------------------------------------------------
  useEffect(() => {
    if (!runId) return;

    runIdRef.current = runId;
    lastSeqRef.current = 0;
    pendingRef.current = [];
    source.reset(runId, 100);

    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    let socket: WebSocket | null = null;

    const patch = (change: Partial<StreamBuffer>) =>
      setBuffer((previous) => {
        const base = previous.runId === runId ? previous : { ...EMPTY, runId };
        return { ...base, ...change };
      });

    const connect = () => {
      if (disposed) return;
      patch({ connection: 'connecting' });
      socket = new WebSocket(socketUrl(runId));

      socket.onopen = () => {
        if (disposed) return;
        attempt = 0;
        lastMessageAtRef.current = Date.now();
        patch({ connection: 'connected', error: null, attempts: 0 });
      };

      socket.onmessage = (raw) => {
        lastMessageAtRef.current = Date.now();
        setStale(false);
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw.data as string);
        } catch {
          return;
        }
        const message = parseSocketMessage(parsed);
        if (!message) return;

        switch (message.type) {
          case 'snapshot':
            // A fresh subscription: start the timeline over.
            source.reset(message.state.run_id, message.state.duration_s);
            lastSeqRef.current = 0;
            if (message.event) {
              source.ingest(message.event);
              lastSeqRef.current = message.event.seq;
              pendingRef.current.push(message.event);
            }
            patch({ state: message.state });
            break;
          case 'seek':
            // A seek moves the cursor; it does NOT invalidate the timeline.
            // Resetting the buffer here blanked every chart on each scrub, and
            // left `sampleAt` with a single event and nothing to interpolate
            // between — which frame-stepped capture would have inherited.
            // Sequence tracking restarts because a backward seek rebuilds the
            // simulation from the same seed; the re-emitted events are
            // identical and are deduplicated by `seq`.
            lastSeqRef.current = 0;
            if (message.event) {
              source.ingest(message.event);
              lastSeqRef.current = message.event.seq;
              pendingRef.current.push(message.event);
            }
            patch({ state: message.state });
            break;
          case 'event': {
            const event = message.event;
            const expected = lastSeqRef.current + 1;
            if (lastSeqRef.current > 0 && event.seq > expected) {
              const gap = event.seq - expected;
              setBuffer((previous) =>
                previous.runId === runId ? { ...previous, dropped: previous.dropped + gap } : previous,
              );
            }
            if (event.seq > lastSeqRef.current) lastSeqRef.current = event.seq;
            source.ingest(event);
            pendingRef.current.push(event);
            break;
          }
          case 'tick':
          case 'status':
            patch({ state: message.state });
            break;
          case 'error':
            patch({ connection: 'error', error: message.detail });
            break;
        }
      };

      socket.onerror = () => {
        if (!disposed) patch({ connection: 'error' });
      };

      socket.onclose = () => {
        socket = null;
        if (disposed) return;
        attempt += 1;
        patch({ connection: 'disconnected', attempts: attempt });
        // Bounded exponential backoff, capped so a dead backend does not become
        // a busy loop.
        const delay = Math.min(1000 * 2 ** Math.min(attempt - 1, 4), 15000);
        retryTimer = setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, [runId, source]);

  return {
    source,
    connection: runId ? active.connection : 'idle',
    stale: Boolean(runId) && stale,
    state: active.state,
    latest: active.latest,
    decisions: active.decisions,
    history: active.history,
    droppedSequences: active.dropped,
    error: active.error,
    reconnectAttempts: active.attempts,
  };
}

/** Convenience: a stable callback that never throws into render. */
export function useSafeAction<T extends unknown[]>(
  fn: (...args: T) => Promise<unknown>,
  onError?: (message: string) => void,
): (...args: T) => void {
  return useCallback(
    (...args: T) => {
      fn(...args).catch((cause: unknown) => {
        const message = cause instanceof Error ? cause.message : String(cause);
        console.error('[CONTINUA]', message);
        onError?.(message);
      });
    },
    [fn, onError],
  );
}
