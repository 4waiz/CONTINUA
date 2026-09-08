'use client';

/**
 * The one channel the video capture harness uses to drive burned-in text.
 *
 * The harness (`scripts/capture-demo.mjs`) owns the video timeline; the page
 * owns the typography. Rather than have the page re-parse `timeline.json` and
 * risk the two disagreeing about what second it is, the harness pushes the
 * overlay for the frame it is about to grab and the page renders exactly that.
 *
 * A plain external store rather than component state, because the writer is
 * outside React entirely. `useSyncExternalStore` is correct here — unlike the
 * scene's per-frame ref, this value changes about a dozen times in the whole
 * video and every change goes through `set`, so subscribers really are notified.
 *
 * When nothing is pushed the overlay is empty, which is what a developer
 * opening /capture by hand should see.
 */

export type OverlayKind = 'title' | 'banner' | 'callout' | 'step' | 'stat';

export interface CaptureOverlay {
  kind: OverlayKind;
  text: string;
  sub?: string;
  /** Playback rate against the run's own clock. Shown whenever it is not 1. */
  rate?: number;
  /** Video timestamp, for the harness's own frame accounting. */
  videoT?: number;
}

let current: CaptureOverlay[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function setCaptureOverlays(next: CaptureOverlay[]): void {
  current = next;
  emit();
}

export function subscribeOverlays(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getOverlays(): CaptureOverlay[] {
  return current;
}

/** Stable empty array so the server snapshot never triggers a re-render loop. */
const EMPTY: CaptureOverlay[] = [];
export function getServerOverlays(): CaptureOverlay[] {
  return EMPTY;
}

declare global {
  interface Window {
    __CONTINUA_OVERLAY__?: (overlays: CaptureOverlay[]) => void;
  }
}

/** Installed by the capture view so Playwright can reach it. */
export function installOverlayBridge(): void {
  if (typeof window === 'undefined') return;
  window.__CONTINUA_OVERLAY__ = setCaptureOverlays;
}
