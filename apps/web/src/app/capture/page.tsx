/* Copyright (c) 2026 Kanban Studios F.Z.E. All rights reserved. Proprietary - see LICENSE. KS-CONTINUA-10DA54CF14F0 */
import type { Metadata } from 'next';
import { CaptureShell } from '@/components/Shells';

export const metadata: Metadata = {
  title: 'Capture - CONTINUA',
  description: 'Fixed 16:9 capture frame for video recording.',
};

export default function Page() {
  return <CaptureShell />;
}
