/* Copyright (c) 2026 Kanban Studios F.Z.E. All rights reserved. Proprietary - see LICENSE. KS-CONTINUA-BFAFD6282D25 */
import type { Metadata } from 'next';
import { ScenarioLabShell } from '@/components/Shells';

export const metadata: Metadata = {
  title: 'Scenario Lab - CONTINUA',
  description: 'Configure failures, congestion, movement and workload, then run the scenario.',
};

export default function Page() {
  return <ScenarioLabShell />;
}
