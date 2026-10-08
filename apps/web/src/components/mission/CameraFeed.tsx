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
 *
 * Beside a reactive baseline (compare mode) the tile splits: the same view,
 * the left half CONTINUA's stream and the right half the baseline's - the
 * order of the status cards at the top - each moving only while its own run's
 * video does. In the engine both rovers are in the same place - the route and
 * its timing are generated before any policy runs - so where the halves stop
 * meeting at the divider, one stream has stalled. (The scene draws the normal
 * rover standing while its link is down, and so behind; the picture is still
 * rendered from the run's rover, and only its half's motion is the baseline's.)
 */

import type { EngineEvent } from '@continua/contracts/engine';
import {
  ROVER_CAM_HEIGHT,
  ROVER_CAM_WIDTH,
  feedRoverCam,
  setRoverCamSink,
  setRoverCamStalled,
} from '@continua/scene';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { CameraIcon, ChevronIcon } from '../ui/icons';
import { InfoTip } from '../ui/InfoTip';

type VideoClass = NonNullable<NonNullable<EngineEvent['app']>['classes']['video']>;

/** One run's picture: a bitmap renderer, cropped to its half in split mode. */
function Picture({
  canvasRef,
  half,
  visible,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  half: 'left' | 'right' | null;
  visible: boolean;
}) {
  return (
    <div
      className="absolute inset-y-0 overflow-hidden"
      style={half === null ? { left: 0, right: 0 } : half === 'left' ? { left: 0, width: '50%' } : { right: 0, width: '50%' }}
    >
      <canvas
        ref={canvasRef}
        width={ROVER_CAM_WIDTH}
        height={ROVER_CAM_HEIGHT}
        className="absolute top-0 block h-full max-w-none"
        style={{
          width: half === null ? '100%' : '200%',
          left: half === 'right' ? '-100%' : 0,
          opacity: visible ? 1 : 0,
        }}
      />
    </div>
  );
}

/**
 * A half's state: the session itself down (red), or only the video stalled
 * while the link holds (amber) - a controller that holds video back to keep
 * steering alive on a thin link is doing its job, and must not look like the
 * rover that lost everything.
 */
function HalfState({
  video,
  inOutage,
  side,
  plain,
}: {
  video: VideoClass | undefined;
  inOutage: boolean;
  side: 'left' | 'right' | null;
  plain: boolean;
}) {
  if (!inOutage && !video?.stalled_now) return null;
  const stall = video?.stall_ms != null ? ` · ${video.stall_ms.toFixed(0)} ms` : '';
  return (
    <div
      className="absolute inset-y-0 grid place-items-center bg-[rgb(16_23_37/0.42)]"
      style={side === null ? { left: 0, right: 0 } : side === 'left' ? { left: 0, width: '50%' } : { right: 0, width: '50%' }}
    >
      <span
        className="rounded-full px-2.5 py-1 text-[11px] font-semibold text-white"
        style={{ background: inOutage ? 'var(--color-bad)' : 'var(--color-warn)' }}
      >
        {inOutage ? (plain ? 'LINK LOST' : 'SESSION DOWN') : plain ? 'VIDEO PAUSED' : `STALLED${stall}`}
      </span>
    </div>
  );
}

export function CameraFeed({
  event,
  baseline,
  baselineLabel = 'Reactive',
  mainLabel = 'CONTINUA',
  defaultOpen,
  compact = false,
  bare = false,
}: {
  event: EngineEvent | null;
  /**
   * The reactive baseline's event at the same moment of the run, or undefined
   * outside compare mode (null while its first event is on its way).
   */
  baseline?: EngineEvent | null;
  baselineLabel?: string;
  mainLabel?: string;
  /** Start open, whatever the screen height (the story and the simple view have room). */
  defaultOpen?: boolean;
  /** The pictures alone: the frame counts and deadline misses are for Details. */
  compact?: boolean;
  /** The picture with no card around it, always open: for a panel that frames it itself. */
  bare?: boolean;
}) {
  const primaryRef = useRef<HTMLCanvasElement>(null);
  const baselineRef = useRef<HTMLCanvasElement>(null);
  // Open by default only where the right column has room for it under the
  // route map and the health panel; elsewhere it is one click away.
  const [toggled, setOpen] = useState(() => defaultOpen ?? (typeof window === 'undefined' || window.innerHeight >= 1000));
  const open = bare || toggled;
  const split = baseline !== undefined;
  const video = event?.app?.classes.video;
  const baseVideo = baseline?.app?.classes.video;
  const streaming = Boolean(video);
  const stalled = video?.stalled_now === true;
  const baseStalled = !baseVideo || baseVideo.stalled_now === true;
  const delivered = video?.frames_delivered;
  const baseDelivered = baseVideo?.frames_delivered;

  // The latest stall states, read by the sink without re-registering it.
  const live = useRef({ stalled, baseStalled, split });
  useEffect(() => {
    live.current = { stalled, baseStalled, split };
  }, [stalled, baseStalled, split]);

  // Take the forward camera's pictures while the tile is open and a run streams.
  // Each picture goes to the canvas of every run whose video is moving; a
  // bitmap renderer shows it without copying, so the half that is frozen just
  // keeps the last picture it was given.
  useEffect(() => {
    const primary = primaryRef.current?.getContext('bitmaprenderer') ?? null;
    if (!open || !streaming || !primary) return undefined;
    setRoverCamSink((picture) => {
      const { stalled: frozen, baseStalled: baseFrozen, split: twoRuns } = live.current;
      const secondary = twoRuns ? (baselineRef.current?.getContext('bitmaprenderer') ?? null) : null;
      if (secondary && !baseFrozen && !frozen) {
        void createImageBitmap(picture).then((copy) => secondary.transferFromImageBitmap(copy));
        primary.transferFromImageBitmap(picture);
      } else if (!frozen) {
        primary.transferFromImageBitmap(picture);
      } else if (secondary && !baseFrozen) {
        secondary.transferFromImageBitmap(picture);
      } else {
        picture.close();
      }
    });
    return () => setRoverCamSink(null);
  }, [open, streaming]);

  // Each newly delivered frame keeps the picture moving; a stall freezes it.
  // Beside a baseline, the camera keeps rendering while either stream moves.
  useEffect(() => {
    if (delivered !== undefined) feedRoverCam();
  }, [delivered]);
  useEffect(() => {
    if (split && baseDelivered !== undefined) feedRoverCam();
  }, [split, baseDelivered]);
  useEffect(() => {
    setRoverCamStalled(stalled && (!split || baseStalled));
  }, [stalled, split, baseStalled]);

  const picture = (
    <div className="relative aspect-video overflow-hidden rounded-[11px] bg-[#1b2435]">
      <Picture canvasRef={primaryRef} half={split ? 'left' : null} visible={streaming} />
      {split && <Picture canvasRef={baselineRef} half="right" visible={streaming} />}
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
          {split ? (
            <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-between bg-gradient-to-b from-[rgb(10_16_28/0.5)] to-transparent px-2 pb-3 pt-1.5 font-[family-name:var(--font-mono)] text-[11px] font-semibold text-white">
              <span>{compact ? mainLabel.toUpperCase() : `${mainLabel.toUpperCase()} · ${String(video.frames_delivered).padStart(5, '0')}`}</span>
              <span>
                {compact
                  ? baselineLabel.toUpperCase()
                  : `${baselineLabel.toUpperCase()} · ${baseVideo ? String(baseVideo.frames_delivered).padStart(5, '0') : ' - '}`}
              </span>
            </div>
          ) : (
            <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-between bg-gradient-to-b from-[rgb(10_16_28/0.45)] to-transparent px-2 pb-3 pt-1.5 font-[family-name:var(--font-mono)] text-[11px] font-semibold text-white">
              <span>FWD · FRAME {String(video.frames_delivered).padStart(6, '0')}</span>
              <span>t+{(event?.t ?? 0).toFixed(1)}s</span>
            </div>
          )}
          {split && (
            <span aria-hidden className="pointer-events-none absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 bg-white/85 shadow-[0_0_0_1px_rgb(10_16_28/0.25)]" />
          )}
        </>
      )}
      {!video && (
        <div className="absolute inset-0 grid place-items-center text-[11.5px] font-medium text-white/60">
          no stream until a run starts
        </div>
      )}
      {video && (
        <HalfState video={video} inOutage={event?.app?.in_outage === true} side={split ? 'left' : null} plain={compact} />
      )}
      {split && baseline && (
        <HalfState video={baseVideo} inOutage={baseline.app?.in_outage === true} side="right" plain={compact} />
      )}
      {/* On the picture itself, where it cannot be missed - and out of a
          header that, at 1280 px, it pushed into an ellipsis. */}
      <span
        className="absolute bottom-1.5 left-1.5 rounded-full bg-[rgb(10_16_28/0.55)] px-1.5 py-[1px] text-[10px] font-bold tracking-[0.06em] text-[color:color-mix(in_srgb,var(--color-warn)_50%,white)]"
        title="The simulated world rendered from the rover's forward camera - not transported pixels. It moves only while the engine reports video frames delivered, and freezes while the receiver reports the stream stalled."
      >
        SYNTHETIC
      </span>
    </div>
  );

  if (bare) return picture;

  return (
    <section className="glass overflow-hidden" aria-label="Camera">
      <div className="flex w-full items-center gap-2 px-4 py-2.5">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          <CameraIcon size={15} className="shrink-0 text-[color:var(--color-faint)]" />
          <span className="section-label truncate whitespace-nowrap">{split ? 'Operator views' : 'Camera'}</span>
        </button>
        <InfoTip
          align="end"
          text={
            compact
              ? "Each rover's forward camera as its operator receives it. VIDEO PAUSED: the link holds but no new frames arrive. LINK LOST: no link at all. Drawn from the simulation, not real video."
              : "The rover's forward camera as its operator receives it. A picture freezes when that rover's video stalls; SESSION DOWN means no link at all. Drawn from the simulation, not real video."
          }
        />
        <button
          type="button"
          className="grid h-6 w-6 shrink-0 place-items-center rounded-full"
          onClick={() => setOpen((value) => !value)}
          aria-label={open ? 'Hide the camera' : 'Show the camera'}
        >
          <ChevronIcon
            size={14}
            className="text-[color:var(--color-faint)] transition-transform"
            style={{ transform: open ? 'rotate(90deg)' : undefined }}
          />
        </button>
      </div>
      {open && (
        <div className="px-3 pb-3">
          {picture}
          {compact ? null : split ? (
            <dl className="mt-2 grid grid-cols-[auto_1fr_1fr] gap-x-3 gap-y-0.5 text-[11px]">
              <dt />
              <dd className="font-semibold text-[color:var(--color-blue)]">{mainLabel}</dd>
              <dd className="font-semibold text-[color:var(--color-faint)]">{baselineLabel}</dd>
              <dt className="text-[color:var(--color-faint)]">Delivered</dt>
              <dd className="metric font-semibold">{video ? `${video.frames_delivered}/${video.frames_expected}` : ' - '}</dd>
              <dd className="metric font-semibold">{baseVideo ? `${baseVideo.frames_delivered}/${baseVideo.frames_expected}` : ' - '}</dd>
              <dt className="text-[color:var(--color-faint)]">Miss</dt>
              <dd className="metric font-semibold">
                {video ? (video.deadline_miss_pct != null ? `${video.deadline_miss_pct.toFixed(1)} %` : 'unavailable') : ' - '}
              </dd>
              <dd className="metric font-semibold">
                {baseVideo ? (baseVideo.deadline_miss_pct != null ? `${baseVideo.deadline_miss_pct.toFixed(1)} %` : 'unavailable') : ' - '}
              </dd>
            </dl>
          ) : (
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
          )}
        </div>
      )}
    </section>
  );
}
