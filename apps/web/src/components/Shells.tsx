'use client';

/**
 * Client shells.
 *
 * Each view is dynamically imported with `ssr: false`. These pages own a
 * WebGL canvas and a live WebSocket; neither has anything useful to render on
 * the server, and attempting it only produces hydration noise.
 */

import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { Suspense, type ComponentType } from 'react';

function Skeleton({ label }: { label: string }) {
  return (
    <div className="mx-auto w-full max-w-[1800px] p-4">
      <div className="panel loading-sweep relative h-[78vh] overflow-hidden">
        <div className="absolute inset-0 grid place-items-center">
          <span className="panel-label">{label}</span>
        </div>
      </div>
    </div>
  );
}

const Mission = dynamic(
  () => import('./mission/MissionView').then((m) => m.MissionView as ComponentType),
  { ssr: false, loading: () => <Skeleton label="Preparing mission dashboard" /> },
);
const ScenarioLab = dynamic(
  () => import('./ScenarioLabView').then((m) => m.ScenarioLabView as ComponentType),
  { ssr: false, loading: () => <Skeleton label="Preparing scenario lab" /> },
);
const Experiments = dynamic(
  () => import('./ExperimentsView').then((m) => m.ExperimentsView as ComponentType),
  { ssr: false, loading: () => <Skeleton label="Preparing experiments" /> },
);
const DecisionLog = dynamic(
  () => import('./DecisionLogView').then((m) => m.DecisionLogView as ComponentType),
  { ssr: false, loading: () => <Skeleton label="Preparing decision log" /> },
);
const Capture = dynamic(
  () =>
    import('./CaptureView').then(
      (m) => m.CaptureView as ComponentType<{ runId: string | null; fullBleed?: boolean }>,
    ),
  { ssr: false, loading: () => <Skeleton label="Preparing capture frame" /> },
);

export function MissionShell() {
  return <Mission />;
}
export function ScenarioLabShell() {
  return <ScenarioLab />;
}
export function ExperimentsShell() {
  return <Experiments />;
}
export function DecisionLogShell() {
  return <DecisionLog />;
}

function CaptureInner() {
  const params = useSearchParams();
  // ?fullbleed=1 removes the page chrome so the 16:9 frame *is* the viewport.
  // The video needs 1920x1080 of content, not a rounded card floating on a
  // background; a human opening /capture by hand still gets the framed version.
  return <Capture runId={params.get('run')} fullBleed={params.get('fullbleed') === '1'} />;
}

export function CaptureShell() {
  return (
    <Suspense fallback={<Skeleton label="Preparing capture frame" />}>
      <CaptureInner />
    </Suspense>
  );
}
