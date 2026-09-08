'use client';

/**
 * Client shell for the Phase 1 scene lab.
 *
 * Kept from Phase 1 and still routed at `/scene-lab`: it inspects the vehicle
 * and world against the deterministic *preview* source, with no engine
 * attached. The Phase 2 views live in `Shells.tsx` and use the engine instead.
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

const SceneLabView = dynamic(
  () => import('./SceneLab').then((module) => module.SceneLab as ComponentType),
  { ssr: false, loading: () => <Skeleton label="Preparing CONTINUA scene lab" /> },
);

export function SceneLabShell() {
  return (
    <SceneRuntimeProvider>
      <SceneLabView />
    </SceneRuntimeProvider>
  );
}
