import type { Metadata } from 'next';
import { SceneLabShell } from '@/components/SceneShell';

export const metadata: Metadata = {
  title: 'Scene Lab - CONTINUA',
  description:
    'Inspect the CONTINUA rover, scrub the mission timeline, switch cameras and toggle coverage overlays.',
};

export default function SceneLabPage() {
  return <SceneLabShell />;
}
