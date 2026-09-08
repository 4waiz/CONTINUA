'use client';

/**
 * Client shell: provides the scene runtime and defers the WebGL surface to the
 * browser. `ssr: false` is deliberate — a Canvas has nothing useful to render
 * on the server, and attempting it only produces hydration noise.
 */

import { SceneRuntimeProvider } from '@continua/scene';
import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';

function Skeleton({ label }: { label: string }) {
  return (
    <div className="mx-auto w-full max-w-[1720px] p-5">
      <div className="panel loading-sweep relative h-[70vh] overflow-hidden">
        <div className="absolute inset-0 grid place-items-center">
          <span className="panel-label">{label}</span>
        </div>
      </div>
    </div>
  );
}

const DashboardView = dynamic(
  () => import('./Dashboard').then((module) => module.Dashboard as ComponentType),
  { ssr: false, loading: () => <Skeleton label="Preparing CONTINUA dashboard" /> },
);

const SceneLabView = dynamic(
  () => import('./SceneLab').then((module) => module.SceneLab as ComponentType),
  { ssr: false, loading: () => <Skeleton label="Preparing CONTINUA scene lab" /> },
);

export function DashboardShell() {
  return (
    <SceneRuntimeProvider>
      <DashboardView />
    </SceneRuntimeProvider>
  );
}

export function SceneLabShell() {
  return (
    <SceneRuntimeProvider>
      <SceneLabView />
    </SceneRuntimeProvider>
  );
}
