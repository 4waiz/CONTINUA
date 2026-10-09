/* Copyright (c) 2026 Kanban Studios F.Z.E. All rights reserved. Proprietary - see LICENSE. KS-CONTINUA-D8FF9C2219FE */
import type { Metadata } from 'next';
import { ExperimentsShell } from '@/components/Shells';

export const metadata: Metadata = {
  title: 'Experiments - CONTINUA',
  description: 'Paired comparison of CONTINUA against reactive, multipath and always-redundant baselines.',
};

export default function Page() {
  return <ExperimentsShell />;
}
