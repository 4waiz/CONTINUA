import type { Metadata } from 'next';
import { CaptureShell } from '@/components/Shells';

export const metadata: Metadata = {
  title: 'Capture - CONTINUA',
  description: 'Fixed 16:9 capture frame for video recording.',
};

export default function Page() {
  return <CaptureShell />;
}
