import type { Metadata } from 'next';
import { ChallengeView } from '@/components/ChallengeView';

export const metadata: Metadata = {
  title: 'The brief, answered - CONTINUA',
  description:
    'The EDGE challenge question and its five success criteria - existing mechanisms, the adapted mechanism, the simulation, the comparison and the guidelines - and where CONTINUA meets each.',
};

export default function Page() {
  return <ChallengeView />;
}
