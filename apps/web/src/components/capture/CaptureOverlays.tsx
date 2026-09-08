'use client';

/**
 * Burned-in text for the demo video: titles, step labels, callouts.
 *
 * Deliberately drawn by the app rather than composited in FFmpeg, so the
 * typography, colour and spacing are the product's own and cannot drift from
 * it. Everything is `pointer-events-none` and sits above the scene.
 *
 * The rate badge is not decoration. When the harness slows playback so a pair
 * of events 0.66 s apart is readable, the badge says so — next to a `t+`
 * readout that is always the run's real clock.
 */

import { getOverlays, getServerOverlays, subscribeOverlays, type CaptureOverlay } from '@/lib/captureOverlay';
import { useSyncExternalStore } from 'react';

export function CaptureOverlays() {
  const overlays = useSyncExternalStore(subscribeOverlays, getOverlays, getServerOverlays);
  if (overlays.length === 0) return null;

  const title = overlays.find((overlay) => overlay.kind === 'title');
  const banner = overlays.find((overlay) => overlay.kind === 'banner');
  const step = overlays.find((overlay) => overlay.kind === 'step');
  const callout = overlays.find((overlay) => overlay.kind === 'callout');
  const stat = overlays.find((overlay) => overlay.kind === 'stat');
  const rate = overlays.find((overlay) => overlay.rate !== undefined)?.rate;

  return (
    <div className="pointer-events-none absolute inset-0 select-none">
      {title ? <TitleCard overlay={title} /> : null}
      {banner ? <Banner overlay={banner} /> : null}

      <div className="absolute bottom-[13%] left-[3.4%] flex max-w-[52%] flex-col gap-3">
        {step ? <StepChip overlay={step} /> : null}
        {callout ? <Callout overlay={callout} /> : null}
      </div>

      {stat ? <Stat overlay={stat} /> : null}
      {rate !== undefined && Math.abs(rate - 1) > 0.01 ? <RateBadge rate={rate} /> : null}
    </div>
  );
}

function TitleCard({ overlay }: { overlay: CaptureOverlay }) {
  return (
    <div className="absolute inset-0 grid place-items-center bg-[color:var(--color-bg)]/70 backdrop-blur-[2px]">
      <div className="text-center">
        <div
          className="text-[7.2vw] font-semibold leading-none tracking-[-0.045em]"
          style={{
            background: 'linear-gradient(96deg,#176BFF,#7C3CFF)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent',
          }}
        >
          {overlay.text}
        </div>
        {overlay.sub ? (
          <div className="mt-[1.1vw] text-[1.55vw] tracking-[0.02em] text-[color:var(--color-ink)]">
            {overlay.sub}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Banner({ overlay }: { overlay: CaptureOverlay }) {
  return (
    <div className="absolute left-1/2 top-[8.5%] -translate-x-1/2">
      <div className="rounded-[12px] border-2 border-[color:var(--color-warn)] bg-[color:var(--color-warn)]/[0.12] px-[1.6vw] py-[0.7vw] text-[1.35vw] font-semibold uppercase tracking-[0.12em] text-[#8a5200]">
        {overlay.text}
      </div>
    </div>
  );
}

function StepChip({ overlay }: { overlay: CaptureOverlay }) {
  return (
    <div className="w-fit rounded-[14px] border border-[color:var(--color-line-strong)] bg-white/95 px-[1.5vw] py-[0.85vw] shadow-[var(--shadow-raised)] backdrop-blur">
      <div
        className="text-[1.85vw] font-semibold leading-none tracking-[-0.02em]"
        style={{
          background: 'linear-gradient(96deg,#176BFF,#7C3CFF)',
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          color: 'transparent',
        }}
      >
        {overlay.text}
      </div>
      {overlay.sub ? (
        <div className="mt-[0.4vw] text-[1.02vw] leading-[1.35] text-[color:var(--color-ink)]">{overlay.sub}</div>
      ) : null}
    </div>
  );
}

function Callout({ overlay }: { overlay: CaptureOverlay }) {
  return (
    <div className="w-fit rounded-[12px] border-l-[3px] border-[color:var(--color-blue)] bg-white/95 px-[1.3vw] py-[0.7vw] shadow-[var(--shadow-panel)] backdrop-blur">
      <div className="text-[1.35vw] font-semibold leading-tight">{overlay.text}</div>
      {overlay.sub ? (
        <div className="mt-[0.25vw] text-[0.98vw] leading-[1.35] text-[color:var(--color-muted)]">{overlay.sub}</div>
      ) : null}
    </div>
  );
}

function Stat({ overlay }: { overlay: CaptureOverlay }) {
  return (
    <div className="absolute right-[3.4%] top-[26%] text-right">
      <div className="metric text-[6.2vw] font-semibold leading-none tracking-[-0.045em] text-[color:var(--color-bad)]">
        {overlay.text}
      </div>
      {overlay.sub ? (
        <div className="mt-[0.5vw] max-w-[26vw] text-[1.02vw] leading-[1.35] text-[color:var(--color-ink)]">
          {overlay.sub}
        </div>
      ) : null}
    </div>
  );
}

function RateBadge({ rate }: { rate: number }) {
  return (
    <div className="absolute right-[3.4%] bottom-[13%] rounded-[10px] border border-[color:var(--color-line-strong)] bg-white/95 px-[0.9vw] py-[0.4vw] text-[0.95vw] font-semibold tracking-[0.06em] text-[color:var(--color-muted)] backdrop-blur">
      PLAYBACK {rate.toFixed(2)}× · t+ IS THE RUN CLOCK
    </div>
  );
}
