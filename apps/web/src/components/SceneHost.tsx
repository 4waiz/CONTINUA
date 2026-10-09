'use client';
/* Copyright (c) 2026 Kanban Studios F.Z.E. All rights reserved. Proprietary - see LICENSE. KS-CONTINUA-2BE23B846F1A */

/**
 * The app's one 3D canvas (see `sceneHostStore`).
 *
 * Rendered from the root layout, so it outlives every navigation, and portalled
 * into a container element that the scene page on screen holds in its own box.
 * It draws that page's runtime; with no scene page open it keeps the last one,
 * paused, so coming back is a runtime swap rather than a rebuild. While the
 * story film plays over it, it holds on its last frame.
 */

import { ContinuaScene, SceneRuntimeBridge } from '@continua/scene';
import { createPortal } from 'react-dom';
import { SceneErrorBoundary } from './SceneStatus';
import { markSceneDrawn, sceneCanvasContainer, useSceneHost } from './sceneHostStore';

/**
 * A frame-stepping capture harness sets `window.__CONTINUA_CAPTURE__` before
 * the page loads. Its frames come at whatever pace it steps them, so the
 * frame-rate governor - which would read that pace as a slow GPU and step the
 * quality down mid-shot - is off.
 */
function capturing(): boolean {
  return typeof window !== 'undefined' && (window as unknown as { __CONTINUA_CAPTURE__?: boolean }).__CONTINUA_CAPTURE__ === true;
}

export function SceneHost() {
  const { active, last, held } = useSceneHost();
  const runtime = active ?? last;
  if (!runtime) return null;

  return createPortal(
    <SceneRuntimeBridge runtime={runtime}>
      <SceneErrorBoundary>
        <ContinuaScene
          className="!absolute inset-0"
          active={active !== null && !held}
          onFirstFrame={markSceneDrawn}
          adaptive={!capturing()}
        />
      </SceneErrorBoundary>
    </SceneRuntimeBridge>,
    sceneCanvasContainer(),
  );
}
