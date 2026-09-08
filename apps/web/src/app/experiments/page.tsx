import type { Metadata } from 'next';
import { ExperimentsShell } from '@/components/Shells';

export const metadata: Metadata = {
  title: 'Experiments — CONTINUA',
  description: 'Paired comparison of CONTINUA against reactive, multipath and always-redundant baselines.',
};

export default function Page() {
  return <ExperimentsShell />;
}
