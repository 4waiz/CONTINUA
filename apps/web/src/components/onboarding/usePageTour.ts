'use client';
/* Copyright (c) 2026 Kanban Studios F.Z.E. All rights reserved. Proprietary - see LICENSE. KS-CONTINUA-5C136D65ACC7 */

/**
 * A page's tour: whether it is open and at which step, whether this browser
 * has been through it, and the first-visit offer.
 *
 * Remembered per browser, in `localStorage` - which can be missing or refuse
 * (a private window, blocked site data): then every visit counts as the
 * first, and nothing else changes. `?tour` in the address starts the tour
 * whatever was remembered: the link to send someone who should see it.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { registerTour } from './tourStore';

const storageKey = (id: string) => `continua.tour.${id}.v1`;

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether the address asks for the page's tour: `?tour`. */
export function tourLinked(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).has('tour');
}

function remembered(id: string): boolean {
  try {
    return window.localStorage.getItem(storageKey(id)) !== null;
  } catch {
    return false;
  }
}

function remember(id: string, value: 'done' | 'declined'): void {
  try {
    window.localStorage.setItem(storageKey(id), value);
  } catch {
    // Not kept: the offer comes again next visit.
  }
  for (const listener of listeners) listener();
}

/** Whether this browser has taken or declined the tour; null before the page is on the client. */
export function useTourRemembered(id: string): boolean | null {
  return useSyncExternalStore(
    subscribe,
    () => remembered(id),
    () => null,
  );
}

export interface PageTour {
  readonly open: boolean;
  readonly step: number;
  readonly setStep: (step: number) => void;
  /** Opens the tour at its first step. */
  readonly start: () => void;
  /** Closes it; `finished` when its last step was reached. */
  readonly close: (finished: boolean) => void;
  /** A first visit: offer the tour. */
  readonly offer: boolean;
  /** "Not now": the offer is not made again in this browser. */
  readonly decline: () => void;
  /** Taken or declined before, in this browser; null until known. */
  readonly known: boolean | null;
}

export function usePageTour(
  id: string,
  options: {
    /** Offered, and in the top bar's Guide, only while this holds. */
    enabled?: boolean;
    /**
     * Whether `?tour` opens it as soon as the page can. A page that opens its
     * tour itself, when it is ready for one, says no and asks `tourLinked()`.
     */
    fromLink?: boolean;
    onOpen?: () => void;
    onClose?: (finished: boolean) => void;
  } = {},
): PageTour {
  const enabled = options.enabled ?? true;
  const fromLink = options.fromLink ?? true;
  const [open, setOpen] = useState(false);
  // Open now, for start and close called twice before a render.
  const opened = useRef(false);
  const [step, setStep] = useState(0);
  const known = useTourRemembered(id);
  // The latest callbacks, without restarting anything when they change.
  const callbacks = useRef(options);
  useEffect(() => {
    callbacks.current = options;
  });

  const start = useCallback(() => {
    setStep(0);
    if (opened.current) return;
    opened.current = true;
    setOpen(true);
    callbacks.current.onOpen?.();
  }, []);

  const close = useCallback(
    (finished: boolean) => {
      if (!opened.current) return;
      opened.current = false;
      setOpen(false);
      remember(id, 'done');
      callbacks.current.onClose?.(finished);
    },
    [id],
  );

  const decline = useCallback(() => remember(id, 'declined'), [id]);

  // In the top bar while the page offers it.
  useEffect(() => (enabled ? registerTour({ id, start }) : undefined), [enabled, id, start]);

  // `?tour` starts it once, as soon as the page can. Marked as done when the
  // timer fires, not when it is set: under React's development double-invoke
  // the first timer is cleared, and the second must still start it.
  const linked = useRef(false);
  useEffect(() => {
    if (!enabled || !fromLink || linked.current || !tourLinked()) return undefined;
    const timer = setTimeout(() => {
      if (linked.current) return;
      linked.current = true;
      start();
    }, 600);
    return () => clearTimeout(timer);
  }, [enabled, fromLink, start]);

  return { open, step, setStep, start, close, offer: enabled && known === false && !open, decline, known };
}
