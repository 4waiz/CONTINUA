'use client';

/**
 * The tour of the page on screen, for the top bar's Guide button: a page that
 * has one registers how to start it while it is shown, and the bar offers it.
 * Module state with a subscription - like `sceneHostStore` - rather than a
 * context threaded through every page.
 */

import { useSyncExternalStore } from 'react';

export interface RegisteredTour {
  /** Which tour: one per page, or per view of a page. */
  readonly id: string;
  /** Starts it from its first step. */
  readonly start: () => void;
}

let current: RegisteredTour | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Offers `tour` in the top bar until the returned function withdraws it. */
export function registerTour(tour: RegisteredTour): () => void {
  current = tour;
  emit();
  return () => {
    if (current === tour) {
      current = null;
      emit();
    }
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The tour the page on screen offers, or null. */
export function useRegisteredTour(): RegisteredTour | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}
