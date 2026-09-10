import type { Metadata } from 'next';
import { ReferenceImagesView } from '@/components/ReferenceImagesView';

export const metadata: Metadata = {
  title: 'Supporting materials — CONTINUA',
  description:
    'The ATP 2026 EDGE engineering sheets for CONTINUA: concept, route, handoff logic, calculations and testbed.',
};

export default function Page() {
  return <ReferenceImagesView />;
}
