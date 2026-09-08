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
 *    duplicates from a resubscribe are dropped and gaps are reported so the UI
 *    can say the history is incomplete rather than pretending it is whole.
 * 3. **Stay off the render path.** Events feed an `EngineSceneStateSource`
 *    (mutable, read inside `useFrame`); React state updates are throttled.
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

export interface EngineRunHandle {
  source: EngineSceneStateSource;
  connection: ConnectionState;
  /** True when the last event is older than the staleness threshold. */
  stale: boolean;
  state: EngineRunState | null;
  latest: EngineEvent | null;
  /** Decisions only — events that carried an action other than `none`. */
  decisions: EngineEvent[];
  /** History for the charts. Capped; the full log lives in the backend. */
  history: EngineEvent[];
  droppedSequences: number;
  error: string | null;
  reconnectAttempts: number;
}

const HISTORY_LIMIT = 900;
const DECISION_LIMIT = 200;
const STALE_AFTER_MS = 4000;
const UI_THROTTLE_MS = 180;

export function useEngineRun(runId: string | null): EngineRunHandle {
  const source = useMemo(() => new EngineSceneStateSource(runId ?? 'engine', 100), []);

  const [connection, setConnection] = useState<ConnectionState>('idle');
  const [state, setState] = useState<EngineRunState | null>(null);
  const [latest, setLatest] = useState<EngineEvent | null>(null);
  const [decisions, setDecisions] = useState<EngineEvent[]>([]);
  const [history, setHistory] = useState<EngineEvent[]>([]);
  const [droppedSequences, setDropped] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [stale, setStale] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const lastSeqRef = useRef(0);
  const lastMessageAtRef = useRef(0);
  const pendingRef = useRef<EngineEvent[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const closedByUsRef = useRef(false);

  // --- throttled hand-off from the socket to React --------------------------
  useEffect(() => {
    flushTimerRef.current = setInterval(() => {
      const pending = pendingRef.current;
      if (pending.length === 0) return;
      pendingRef.current = [];
      const newest = pending[pending.length - 1]!;
      setLatest(newest);
      setHistory((previous) => {
        const next = previous.concat(pending);
        return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next;
      });
      const acted = pending.filter((event) => event.action && event.action.kind !== 'none');
      if (acted.length) {
        setDecisions((previous) => {
          const next = previous.concat(acted);
          return next.length > DECISION_LIMIT ? next.slice(next.length - DECISION_LIMIT) : next;
        });
      }
    }, UI_THROTTLE_MS);
    return () => {
      if (flushTimerRef.current) clearInterval(flushTimerRef.current);
    };
  }, []);

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
    if (!runId) {
      setConnection('idle');
      return;
    }

    source.reset(runId, 100);
    lastSeqRef.current = 0;
    pendingRef.current = [];
    setHistory([]);
    setDecisions([]);
    setDropped(0);
    setLatest(null);
    setError(null);
    closedByUsRef.current = false;

    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      setConnection('connecting');
      const socket = new WebSocket(socketUrl(runId));
      socketRef.current = socket;

      socket.onopen = () => {
        if (disposed) return;
        attempt = 0;
        setReconnectAttempts(0);
        setConnection('connected');
        setError(null);
        lastMessageAtRef.current = Date.now();
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
          case 'seek':
            setState(message.state);
            source.reset(message.state.run_id, message.state.duration_s);
            lastSeqRef.current = 0;
            if (message.event) {
              source.ingest(message.event);
              lastSeqRef.current = message.event.seq;
              pendingRef.current.push(message.event);
            }
            break;
          case 'event': {
            const event = message.event;
            const expected = lastSeqRef.current + 1;
            if (lastSeqRef.current > 0 && event.seq > expected) {
              // A real gap: the socket missed events while we were away.
              setDropped((previous) => previous + (event.seq - expected));
            }
            if (event.seq > lastSeqRef.current) lastSeqRef.current = event.seq;
            source.ingest(event);
            pendingRef.current.push(event);
            break;
          }
          case 'tick':
          case 'status':
            setState(message.state);
            break;
          case 'error':
            setError(message.detail);
            setConnection('error');
            break;
        }
      };

      socket.onerror = () => {
        if (disposed) return;
        setConnection('error');
      };

      socket.onclose = () => {
        socketRef.current = null;
        if (disposed || closedByUsRef.current) return;
        setConnection('disconnected');
        attempt += 1;
        setReconnectAttempts(attempt);
        // Bounded exponential backoff, capped so a dead backend does not turn
        // into a busy loop.
        const delay = Math.min(1000 * 2 ** Math.min(attempt - 1, 4), 15000);
        retryTimer = setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      disposed = true;
      closedByUsRef.current = true;
      if (retryTimer) clearTimeout(retryTimer);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [runId, source]);

  return {
    source,
    connection,
    stale,
    state,
    latest,
    decisions,
    history,
    droppedSequences,
    error,
    reconnectAttempts,
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
