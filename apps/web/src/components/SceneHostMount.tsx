'use client';

/**
 * Mounts the shared scene canvas from the root layout, so it survives every
 * navigation - but only once a scene page has asked for it, so Experiments or
 * the Decision Log opened on their own never download three.js. Client only:
 * WebGL has nothing to render on the server.
 */

import dynamic from 'next/dynamic';
import { useSceneHost } from './sceneHostStore';

const SceneHost = dynamic(() => import('./SceneHost').then((module) => module.SceneHost), { ssr: false });

export function SceneHostMount() {
  const { last } = useSceneHost();
  return last ? <SceneHost /> : null;
}
