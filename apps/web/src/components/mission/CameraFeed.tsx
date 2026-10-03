'use client';

/**
 * The rover's forward camera, as the operator would see it picture-in-picture.
 *
 * The picture is the simulated world rendered from the camera windows on the
 * rover's sensor crown - synthetic, never transported pixels, and the badge
 * says so. What it stands for is the video class, so it behaves like it: it
 * moves only while the engine keeps reporting newly delivered video frames, it
 * freezes the moment the receiver reports the stream stalled, and the frame
 * counter is the engine's own count. A local render that carried on through a
 * stall would be no evidence that video survived.
 */

import type { EngineEvent } from '@continua/contracts/engine';
import {
  ROVER_CAM_HEIGHT,
  ROVER_CAM_WIDTH,
  feedRoverCam,
  setRoverCamSink,
  setRoverCamStalled,
} from '@continua/scene';
import { useEffect, useRef, useState } from 'react';
import { CameraIcon, ChevronIcon } from '../ui/icons';

export function CameraFeed({ event }: { event: EngineEvent | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Open by default only where the right column has room for it under the
  // route map and the health panel; elsewhere it is one click away.
  const [open, setOpen] = useState(() => typeof window === 'undefined' || window.innerHeight >= 1000);
  const video = event?.app?.classes.video;
  const streaming = Boolean(video);
  const stalled = video?.stalled_now === true;
  const delivered = video?.frames_delivered;

  // Take the forward camera's pictures while the tile is open and a run streams.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!open || !streaming || !canvas) return undefined;
    const context = canvas.getContext('2d');
    if (!context) return undefined;
    const image = context.createImageData(ROVER_CAM_WIDTH, ROVER_CAM_HEIGHT);
    const row = ROVER_CAM_WIDTH * 4;
    setRoverCamSink((pixels) => {
      // WebGL rows run bottom-up, a 2D canvas's top-down.
      const height = ROVER_CAM_HEIGHT;
      for (let y = 0; y < height; y += 1) {
        image.data.set(pixels.subarray((height - 1 - y) * row, (height - y) * row), y * row);
      }
      context.putImageData(image, 0, 0);
    });
    return () => setRoverCamSink(null);
  }, [open, streaming]);

  // Each newly delivered frame keeps the picture moving; a stall freezes it.
  useEffect(() => {
    if (delivered !== undefined) feedRoverCam();
  }, [delivered]);

  useEffect(() => {
    setRoverCamStalled(stalled);
  }, [stalled]);

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
          title="The simulated world rendered from the rover's forward camera - not transported pixels. It moves only while the engine reports video frames delivered, and freezes while the receiver reports the stream stalled."
        >
          SYNTHETIC STREAM
        </span>
        <ChevronIcon
          size={14}
          className="text-[color:var(--color-faint)] transition-transform"
          style={{ transform: open ? 'rotate(90deg)' : undefined }}
        />
      </button>
      {open && (
        <div className="px-3 pb-3">
          <div className="relative overflow-hidden rounded-[11px] bg-[#1b2435]">
            <canvas
              ref={canvasRef}
              width={ROVER_CAM_WIDTH}
              height={ROVER_CAM_HEIGHT}
              className="block aspect-video w-full"
              style={{ opacity: streaming ? 1 : 0 }}
            />
            {video && (
              <>
                {/* Framing marks of an inspection camera, kept thin. */}
                <svg
                  className="pointer-events-none absolute inset-0 h-full w-full"
                  viewBox="0 0 160 90"
                  preserveAspectRatio="none"
                  aria-hidden
                >
                  <g fill="none" stroke="rgb(255 255 255 / 0.55)" strokeWidth="0.6" vectorEffect="non-scaling-stroke">
                    <path d="M70 40 h-4 v3 M90 40 h4 v3 M70 50 h-4 v-3 M90 50 h4 v-3" />
                  </g>
                </svg>
                <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-between bg-gradient-to-b from-[rgb(10_16_28/0.45)] to-transparent px-2 pb-3 pt-1.5 font-[family-name:var(--font-mono)] text-[11px] font-semibold text-white">
                  <span>FWD · FRAME {String(video.frames_delivered).padStart(6, '0')}</span>
                  <span>t+{(event?.t ?? 0).toFixed(1)}s</span>
                </div>
              </>
            )}
            {!video && (
              <div className="absolute inset-0 grid place-items-center text-[11.5px] font-medium text-white/60">
                no stream until a run starts
              </div>
            )}
            {stalled && (
              <div className="absolute inset-0 grid place-items-center bg-[rgb(16_23_37/0.42)]">
                <span className="rounded-full bg-[color:var(--color-bad)] px-2.5 py-1 text-[11px] font-semibold text-white">
                  STALLED{video?.stall_ms != null ? ` · ${video.stall_ms.toFixed(0)} ms` : ''}
                </span>
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
              <dd className="metric font-semibold">
                {video ? (video.stall_ms != null ? `${video.stall_ms.toFixed(0)} ms` : 'unavailable') : ' - '}
              </dd>
            </div>
            <div>
              <dt className="text-[color:var(--color-faint)]">Miss</dt>
              <dd className="metric font-semibold">
                {video ? (video.deadline_miss_pct != null ? `${video.deadline_miss_pct.toFixed(1)} %` : 'unavailable') : ' - '}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </section>
  );
}
