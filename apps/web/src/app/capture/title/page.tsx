/* Copyright (c) 2026 Kanban Studios F.Z.E. All rights reserved. Proprietary - see LICENSE. KS-CONTINUA-7EC44A2D9E56 */
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { TitleFrame } from '@/components/capture/TitleFrame';

export const metadata: Metadata = {
  title: 'Title - CONTINUA',
  description: 'Transparent title plate for the demo video.',
};

/** /capture/title?text=CONTINUA&sub=…&place=lower-left */
export default function Page() {
  return (
    <Suspense fallback={null}>
      <TitleFrame />
    </Suspense>
  );
}
