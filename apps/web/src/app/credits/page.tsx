import type { Metadata } from 'next';
import { CreditsView } from '@/components/CreditsView';

export const metadata: Metadata = {
  title: 'Credits - CONTINUA',
  description: 'CONTINUA is made by Team Kanban: the team, what it is built with, and where everything on screen comes from.',
};

export default function Page() {
  return <CreditsView />;
}
