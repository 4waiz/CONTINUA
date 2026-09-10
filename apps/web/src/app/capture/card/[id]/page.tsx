import type { Metadata } from 'next';
import { VideoCard } from '@/components/capture/VideoCard';

export const metadata: Metadata = {
  title: 'Card - CONTINUA',
  description: 'Full-frame evidence card for the demo video.',
};

/**
 * The four cards the demo video is built from. Enumerated so the route can be
 * statically exported: there is no server in the public deployment to render an
 * arbitrary id on demand, and these are the only ids that exist.
 */
export function generateStaticParams() {
  return [{ id: 'compare' }, { id: 'ablation' }, { id: 'results' }, { id: 'scope' }];
}

/** /capture/card/compare | ablation | results | scope */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <VideoCard cardId={id} />;
}
