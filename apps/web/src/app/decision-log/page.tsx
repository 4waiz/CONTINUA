import type { Metadata } from 'next';
import { DecisionLogShell } from '@/components/Shells';

export const metadata: Metadata = {
  title: 'Decision Log — CONTINUA',
  description: 'Every controller action with the observations, policy version and predictor behind it.',
};

export default function Page() {
  return <DecisionLogShell />;
}
