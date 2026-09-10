'use client';

/**
 * A title drawn on nothing.
 *
 * The opening and closing shots are Blender renders, so their titles cannot be
 * drawn by the running app the way the application shots' overlays are. Instead
 * this route renders the same `TitleCard` on a transparent page; the capture
 * harness grabs it with `omitBackground`, and FFmpeg composites the resulting
 * RGBA still over the rendered frames with a fade.
 *
 * Same component, same tokens, same type. Two paths to the screen, one design.
 */

import {
  getOverlays,
  getServerOverlays,
  setCaptureOverlays,
  subscribeOverlays,
} from '@/lib/captureOverlay';
import { useSearchParams } from 'next/navigation';
import { useEffect, useSyncExternalStore } from 'react';
import { CaptureOverlays } from './CaptureOverlays';

export function TitleFrame() {
  const params = useSearchParams();
  const text = params.get('text') ?? '';
  const sub = params.get('sub') ?? undefined;
  const place = params.get('place') === 'lower-left' ? 'lower-left' : 'centre';

  useEffect(() => {
    setCaptureOverlays(text ? [{ kind: 'title', text, sub, place }] : []);
    return () => setCaptureOverlays([]);
  }, [text, sub, place]);

  // Read the store rather than mirroring it into state: the harness waits on
  // `data-capture-ready`, and what it needs to know is that the plate is
  // actually on screen, not that a prop arrived.
  const overlays = useSyncExternalStore(subscribeOverlays, getOverlays, getServerOverlays);
  const ready = overlays.length > 0;

  return (
    <div
      className="relative h-screen w-screen overflow-hidden"
      style={{ background: 'transparent' }}
      data-capture-ready={ready ? 'true' : 'false'}
    >
      {/* globals.css paints `body`, and an opaque body defeats Playwright's
          `omitBackground` - the plate comes back as RGB with no alpha and
          covers the Blender render it was supposed to sit on top of. This
          route is the only place the page ground must not be painted. */}
      <style>{'html,body{background:transparent !important;}'}</style>
      <CaptureOverlays />
    </div>
  );
}
