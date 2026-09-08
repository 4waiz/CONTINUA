import type { Metadata } from 'next';
import { VideoCard } from '@/components/capture/VideoCard';

export const metadata: Metadata = {
  title: 'Card — CONTINUA',
  description: 'Full-frame evidence card for the demo video.',
};

/**
 * One caption card, at /capture/card/compare | ablation | results | scope.
 * The data comes from public/video/cards.json, which is generated from the
 * recorded runs by scripts/build_video_cards.py.
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <VideoCard cardId={id} />;
}
