'use client';
/* Copyright (c) 2026 Kanban Studios F.Z.E. All rights reserved. Proprietary - see LICENSE. KS-CONTINUA-FA0E2E6E97AA */

/**
 * Who the app's one 3D canvas belongs to right now.
 *
 * Mission, Scenario Lab and Scene Lab each used to build a canvas of their
 * own, so every switch between them created a WebGL context, uploaded every
 * model to the GPU again, re-captured the sky environment and showed the
 * loader. Now there is one canvas for the life of the tab (`SceneHost`). The
 * scene page on screen lends it a box - the canvas element is moved into that
 * box, so fullscreen, pointer events and layering behave exactly as if the page
 * owned it - and names the runtime (source, clock, settings) to draw. Moving a
 * canvas element keeps its context, its programs and its buffers.
 *
 * With no scene page open the canvas is detached and its render loop held.
 *
 * Deliberately free of three.js: the root layout reads this store on every
 * page, and a page that never shows the scene must not download it.
 */

import type { SceneRuntime } from '@continua/scene';
import { useSyncExternalStore } from 'react';

export interface SceneHostSnapshot {
  /** The runtime the page on screen wants drawn; null while no scene page is open. */
  readonly active: SceneRuntime | null;
  /** The last runtime drawn. The canvas keeps it, paused, until the next page asks. */
  readonly last: SceneRuntime | null;
  /** The shared canvas has drawn its first frames. */
  readonly drawn: boolean;
  /** Something is playing over the scene (the story film): hold it on its last frame. */
  readonly held: boolean;
}

const EMPTY: SceneHostSnapshot = { active: null, last: null, drawn: false, held: false };

let snapshot: SceneHostSnapshot = EMPTY;
let slotOwner: HTMLElement | null = null;
let container: HTMLDivElement | null = null;
const listeners = new Set<() => void>();

function publish(next: Partial<SceneHostSnapshot>): void {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const read = () => snapshot;
const readServer = () => EMPTY;

export function useSceneHost(): SceneHostSnapshot {
  return useSyncExternalStore(subscribe, read, readServer);
}

/** The element the shared canvas renders into, created once. */
export function sceneCanvasContainer(): HTMLDivElement {
  if (!container) {
    container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.inset = '0';
  }
  return container;
}

/**
 * Lend the shared canvas a box. The returned function takes it back - unless
 * another page has claimed it since, as happens when the next page mounts
 * before the last one unmounts.
 */
export function attachSceneCanvas(slot: HTMLElement): () => void {
  slotOwner = slot;
  slot.appendChild(sceneCanvasContainer());
  return () => {
    if (slotOwner !== slot) return;
    slotOwner = null;
    sceneCanvasContainer().remove();
    publish({ active: null });
  };
}

/** Draw `runtime` on the shared canvas, if `slot` still holds it. */
export function showSceneRuntime(slot: HTMLElement, runtime: SceneRuntime): void {
  if (slotOwner !== slot) return;
  if (snapshot.active === runtime) return;
  publish({ active: runtime, last: runtime });
}

export function markSceneDrawn(): void {
  if (!snapshot.drawn) publish({ drawn: true });
}

let holds = 0;

/**
 * Freeze the shared canvas on its last frame while something plays over it -
 * the story film - so the world does not drive on behind the picture, and the
 * GPU is free for the video. Returns the release; the scene carries on from
 * where it stopped.
 */
export function holdScene(): () => void {
  holds += 1;
  if (holds === 1) publish({ held: true });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds -= 1;
    if (holds === 0) publish({ held: false });
  };
}
