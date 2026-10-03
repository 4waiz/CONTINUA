'use client';

/**
 * The rover's camera, as the operator would see it picture-in-picture.
 *
 * It is a generated test pattern, not transported pixels, and it says so. The
 * frame counter advances **only when the engine reports a newly delivered
 * frame**, so a stall in the model is a visible freeze here - a local render
 * that bypassed the network would be no evidence that video survived.
 */

import type { EngineEvent } from '@continua/contracts/engine';
import { useEffect, useRef, useState } from 'react';
import { CameraIcon, ChevronIcon } from '../ui/icons';

export function CameraFeed({ event }: { event: EngineEvent | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastFrames = useRef(-1);
  // Open by default only where the right column has room for it under the
  // route map and the health panel; elsewhere it is one click away.
  const [open, setOpen] = useState(() => typeof window === 'undefined' || window.innerHeight >= 1000);
  const video = event?.app?.classes.video;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !video || !open) return;
    if (video.frames_delivered === lastFrames.current) return; // stalled: do not redraw
    lastFrames.current = video.frames_delivered;
    const context = canvas.getContext('2d');
    if (!context) return;
    const { width, height } = canvas;
    const gradient = context.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#26324a');
    gradient.addColorStop(1, '#0f1626');
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
    // A horizon and a road vanishing to it: enough to read as a forward view.
    context.fillStyle = 'rgba(255,255,255,0.06)';
    context.fillRect(0, height * 0.55, width, height * 0.45);
    context.strokeStyle = 'rgba(255,255,255,0.18)';
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(width * 0.5 - 2, height * 0.55);
    context.lineTo(width * 0.18, height);
    context.moveTo(width * 0.5 + 2, height * 0.55);
    context.lineTo(width * 0.82, height);
    context.stroke();
    // Reticle.
    context.strokeStyle = 'rgba(18,185,232,0.75)';
    context.lineWidth = 1.2;
    const cx = width / 2;
    const cy = height * 0.5;
    context.strokeRect(cx - 18, cy - 12, 36, 24);
    context.beginPath();
    context.moveTo(cx - 30, cy);
    context.lineTo(cx - 22, cy);
    context.moveTo(cx + 22, cy);
    context.lineTo(cx + 30, cy);
    context.stroke();
    // A moving element, so a frozen frame is obvious at a glance.
    const phase = (video.frames_delivered % 60) / 60;
    context.fillStyle = '#12B9E8';
    context.fillRect(8 + phase * (width - 44), height - 18, 28, 4);
    context.fillStyle = 'rgba(255,255,255,0.9)';
    context.font = '600 10px ui-monospace, monospace';
    context.fillText(`FRAME ${String(video.frames_delivered).padStart(6, '0')}`, 8, 15);
    context.fillText(`t+${(event?.t ?? 0).toFixed(2)}s`, width - 72, 15);
  }, [video, event?.t, open]);

  const stalled = video?.stalled_now === true;

  return (
    <section className="glass overflow-hidden" aria-label="Camera">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <CameraIcon size={15} className="text-[color:var(--color-faint)]" />
        <span className="section-label flex-1">Camera</span>
        <span
          className="rounded-full bg-[color-mix(in_srgb,var(--color-warn)_14%,white)] px-2 py-[2px] text-[11px] font-bold tracking-[0.05em] text-[color:var(--color-warn)]"
          title="Generated test pattern. Frames advance only when the model delivers them. Not transported pixels."
        >
          SYNTHETIC STREAM
        </span>
        <ChevronIcon size={14} className="text-[color:var(--color-faint)] transition-transform" style={{ transform: open ? 'rotate(90deg)' : undefined }} />
      </button>
      {open && (
        <div className="px-3 pb-3">
          <div className="relative overflow-hidden rounded-[11px] bg-[#0f1626]">
            <canvas ref={canvasRef} width={320} height={160} className="block aspect-[2/1] w-full" />
            {!video && (
              <div className="absolute inset-0 grid place-items-center text-[11.5px] font-medium text-white/60">
                no stream until a run starts
              </div>
            )}
            {stalled && (
              <div className="absolute inset-0 grid place-items-center bg-[rgba(16,23,37,0.55)]">
                <span className="rounded-full bg-[color:var(--color-bad)] px-2.5 py-1 text-[11px] font-semibold text-white">STALLED</span>
              </div>
            )}
          </div>
          <dl className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
            <div>
              <dt className="text-[color:var(--color-faint)]">Delivered</dt>
              <dd className="metric font-semibold">{video ? `${video.frames_delivered}/${video.frames_expected}` : ' - '}</dd>
            </div>
            <div>
              <dt className="text-[color:var(--color-faint)]">Stall</dt>
              <dd className="metric font-semibold">{video ? `${(video.stall_ms ?? 0).toFixed(0)} ms` : ' - '}</dd>
            </div>
            <div>
              <dt className="text-[color:var(--color-faint)]">Miss</dt>
              <dd className="metric font-semibold">
                {video?.deadline_miss_pct != null ? `${video.deadline_miss_pct.toFixed(1)} %` : ' - '}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </section>
  );
}
