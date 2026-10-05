'use client';

/**
 * The story mode: a guided minute through the one run that shows what
 * CONTINUA is for, told in plain words over the real run.
 *
 * Two rovers drive the shadowed route side by side, on the same seed - one on
 * CONTINUA with the road map (P3), one that only switches after its network
 * fails (B0) - exactly as Mission's "Compare" runs them. The story never
 * scripts what happens. Each chapter begins when the run reaches it (the
 * rover's place on the route, or a decision the engine actually logged), and
 * every number in a caption is read from the two runs' events at that moment:
 * the distance in the road map's warning, the seconds each operator lost,
 * whether the other rover had to stop. If the engine does something else, the
 * story says that instead, or says nothing.
 *
 * What the story does choose is presentation: the framing, and the playback
 * rate - slowed while a caption is read, quicker between chapters. The rate is
 * always on screen, so slow motion is never mistaken for the rover's speed.
 */

import type { StoryShot, StoryShotId } from '@continua/contracts';
import { actionsOf, type EngineEvent, type EngineLinkId } from '@continua/contracts/engine';
import { route, type DeadZone } from '@continua/scene';
import { useMemo, type ReactNode } from 'react';
import { CloseIcon, PauseIcon, PlayIcon } from '../ui/icons';
import { NETWORK, seconds } from './plain';

/** The run the story tells: the shadowed route, CONTINUA with the road map against the normal rover. */
export const STORY_SCENARIO = 'shadow-survey';
export const STORY_POLICY = 'P3' as const;

export const CHAPTERS = [
  'At the dock',
  'Two rovers',
  'A dead zone ahead',
  'Through the cutting',
  'The rest of the road',
  'The proof',
] as const;

type BeatId = 'dock' | 'wifi' | 'two' | 'ahead' | 'prepare' | 'inside' | 'after' | 'onward' | 'end';

interface Beat {
  id: BeatId;
  /** 1-based chapter. */
  chapter: number;
  shot: StoryShotId;
  /**
   * Seconds of wall time the caption gets at `slow`, before the run goes on at
   * `cruise`. Kept as run time (`read * slow`), so the pace is a function of
   * where the run is - pausing, scrubbing and capture all see the same thing.
   */
  read: number;
  slow: number;
  cruise: number;
}

/** The order the beats come in, for the shot each one eases from. */
const ORDER: readonly BeatId[] = ['dock', 'wifi', 'two', 'ahead', 'prepare', 'inside', 'after', 'onward', 'end'];

const BEATS: Record<BeatId, Beat> = {
  dock: { id: 'dock', chapter: 1, shot: 'dock', read: 5.5, slow: 0.35, cruise: 1 },
  wifi: { id: 'wifi', chapter: 1, shot: 'follow', read: 5, slow: 0.5, cruise: 1.5 },
  two: { id: 'two', chapter: 2, shot: 'alongside', read: 6.5, slow: 0.6, cruise: 2 },
  ahead: { id: 'ahead', chapter: 3, shot: 'crane', read: 6.5, slow: 0.45, cruise: 1 },
  prepare: { id: 'prepare', chapter: 3, shot: 'follow', read: 7.5, slow: 0.35, cruise: 0.8 },
  inside: { id: 'inside', chapter: 4, shot: 'inside', read: 8, slow: 0.4, cruise: 0.6 },
  after: { id: 'after', chapter: 4, shot: 'lead', read: 7, slow: 0.5, cruise: 3 },
  onward: { id: 'onward', chapter: 5, shot: 'aerial', read: 5.5, slow: 2, cruise: 6 },
  end: { id: 'end', chapter: 6, shot: 'aerial', read: 0, slow: 1, cruise: 1 },
};

export interface StoryCaption {
  chapter: number;
  headline: string;
  detail: string | null;
}

/** Outage intervals, from the receiver's `in_outage` edges. */
function outages(events: readonly EngineEvent[]): { from: number; to: number }[] {
  const spans: { from: number; to: number }[] = [];
  let open: number | null = null;
  for (const event of events) {
    const down = event.app?.in_outage === true;
    if (down && open === null) open = event.t;
    if (!down && open !== null) {
      spans.push({ from: open, to: event.t });
      open = null;
    }
  }
  const last = events[events.length - 1];
  if (open !== null && last) spans.push({ from: open, to: last.t });
  return spans;
}

/** Seconds of outage between two times. */
function downBetween(spans: { from: number; to: number }[], from: number, to: number): number {
  let total = 0;
  for (const span of spans) total += Math.max(0, Math.min(span.to, to) - Math.max(span.from, from));
  return total;
}

/** "0:22.9" - a run time as the Decision Log writes it. */
function clock(t: number): string {
  const minutes = Math.floor(t / 60);
  return `${minutes}:${(t - minutes * 60).toFixed(1).padStart(4, '0')}`;
}

/** When the rover first reached a place on the route, from its own events. */
function timeAt(events: readonly EngineEvent[], position: number, reverse: boolean): number | null {
  for (const event of events) {
    const d = event.vehicle?.distance_m;
    if (d === undefined) continue;
    const along = reverse ? route.length - d : d;
    if (reverse ? along <= position : along >= position) return event.t;
  }
  return null;
}

export interface StoryState {
  beat: BeatId | null;
  caption: StoryCaption | null;
  shot: StoryShot | null;
  /** The playback rate the story wants now (before any "Next chapter" hurry). */
  speed: number;
  /** The run has ended: show the proof. */
  finished: boolean;
}

/**
 * Which chapter the run is in, and what to say about it - a pure function of
 * the two runs' events, so scrubbing back retells the same chapter.
 */
export function useStoryDirector({
  active,
  main,
  mainTimeline,
  baseline,
  baselineTimeline,
  completed,
  zones,
  reverse,
}: {
  active: boolean;
  main: EngineEvent | null;
  mainTimeline: readonly EngineEvent[];
  /** The normal rover's event at the same moment. */
  baseline: EngineEvent | null;
  baselineTimeline: readonly EngineEvent[];
  completed: boolean;
  zones: readonly DeadZone[];
  reverse: boolean;
}): StoryState {
  const t = main?.t ?? 0;
  const travelled = main?.vehicle?.distance_m ?? 0;
  const position = reverse ? route.length - travelled : travelled;
  const cut = zones[0] ?? null;
  const cutFrom = cut ? cut.from - cut.ramp / 2 : null;
  const cutTo = cut ? cut.to + cut.ramp / 2 : null;
  const version = mainTimeline.length;

  // The decision the road map made: the first "Preparing ..." the engine logged.
  const prepared = useMemo(
    () => mainTimeline.find((event) => /^Preparing /.test(event.reason ?? '') && actionsOf(event).length > 0) ?? null,
    // The timeline grows in place; its length says when.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mainTimeline, version],
  );
  const toWifi = useMemo(
    () =>
      mainTimeline.find((event) => actionsOf(event).some((action) => action.kind === 'switch' && action.link === 'wifi')) ??
      null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mainTimeline, version],
  );

  let beat: BeatId | null = null;
  if (active) {
    if (completed) beat = 'end';
    else if (cutFrom !== null && cutTo !== null && position > cutTo + 45) beat = 'onward';
    else if (cutTo !== null && position > cutTo + 3) beat = 'after';
    else if (cutFrom !== null && position >= cutFrom - 3) beat = 'inside';
    else if (prepared && t >= prepared.t) beat = 'prepare';
    else if (cutFrom !== null && position > cutFrom - 95) beat = 'ahead';
    else if (position > 55) beat = 'two';
    else if (toWifi && t >= toWifi.t) beat = 'wifi';
    else beat = 'dock';
  }

  // When the beat began, in run time, from the same facts that chose it - so
  // the framing and the pace are functions of the run, like the scene itself.
  const started = useMemo(() => {
    if (!beat) return 0;
    const at = (place: number | null) => (place === null ? null : timeAt(mainTimeline, place, reverse));
    switch (beat) {
      case 'dock':
        return 0;
      case 'wifi':
        return toWifi?.t ?? 0;
      case 'two':
        return at(55) ?? t;
      case 'ahead':
        return at(cutFrom === null ? null : cutFrom - 95) ?? t;
      case 'prepare':
        return prepared?.t ?? t;
      case 'inside':
        return at(cutFrom === null ? null : cutFrom - 3) ?? t;
      case 'after':
        return at(cutTo === null ? null : cutTo + 3) ?? t;
      case 'onward':
        return at(cutTo === null ? null : cutTo + 45) ?? t;
      case 'end':
        return mainTimeline[mainTimeline.length - 1]?.t ?? t;
    }
    return t;
    // Recomputed when the beat changes; `t` is only its fallback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beat, mainTimeline, version, toWifi, prepared, cutFrom, cutTo, reverse]);

  // --- the caption: facts from the two runs at this moment -----------------
  const caption = useMemo<StoryCaption | null>(() => {
    if (!beat) return null;
    const chapter = BEATS[beat].chapter;
    const via = main?.carrying ? NETWORK[main.carrying as EngineLinkId].name : null;
    switch (beat) {
      case 'dock':
        return {
          chapter,
          headline: 'This rescue rover is driven from far away. Its operator needs a live link the whole way: video, steering, sensors.',
          detail: 'It sets off from its dock, where it is plugged in by cable.',
        };
      case 'wifi': {
        const lost = main?.app?.outage_s ?? 0;
        return {
          chapter,
          headline: 'Before the cable came off, Wi-Fi was already warmed up - so the link carried straight on.',
          detail: toWifi
            ? `Moved to Wi-Fi at ${clock(toWifi.t)} · ${lost < 0.05 ? 'no time without a link' : `${seconds(lost)} without a link`}`
            : null,
        };
      }
      case 'two':
        return {
          chapter,
          headline:
            'Two identical rovers drive this road, through exactly the same signal. Ours runs CONTINUA. The other only switches network once the one it is on has failed.',
          detail: 'Top: can each operator still reach their rover? Right: what each operator sees.',
        };
      case 'ahead':
        return {
          chapter,
          headline:
            'Ahead, the road runs through a cutting. Its banks block Wi-Fi and cellular. Only the sky stays open - and that is where the satellite is.',
          detail: 'The road strip below shows it coming: both networks drop out at once.',
        };
      case 'prepare': {
        const ahead = prepared?.reason.match(/(\d+(?:\.\d+)?)\s*m ahead/);
        return {
          chapter,
          headline: `CONTINUA's road map shows the dead zone${ahead ? ` ${Number(ahead[1]).toFixed(0)} m ahead` : ' ahead'}. Satellite needs about 6 seconds to start, so it starts it now.`,
          detail: prepared ? `Decision log, ${clock(prepared.t)}: "${prepared.reason}"` : null,
        };
      }
      case 'inside': {
        const baseDown = baseline?.app?.in_outage === true;
        const mainUp = main?.app ? !main.app.in_outage : null;
        let headline = 'The banks close in: Wi-Fi and cellular fade out.';
        if (mainUp && main?.carrying === 'satellite' && baseDown) {
          headline = 'Wi-Fi and cellular are gone. CONTINUA is already on satellite and still connected. The normal rover has lost its link.';
        } else if (mainUp && main?.carrying === 'satellite') {
          headline = 'Wi-Fi and cellular are gone. CONTINUA moved to satellite in time and is still connected.';
        } else if (baseDown) {
          headline = 'Wi-Fi and cellular are gone, and the normal rover has lost its link.';
        }
        return {
          chapter,
          headline,
          detail: baseDown
            ? `The normal rover: ${seconds(baseline?.app?.outage_s ?? 0)} without a link so far.`
            : via
              ? `CONTINUA's link: ${via}.`
              : null,
        };
      }
      case 'after': {
        if (cutFrom === null || cutTo === null) return null;
        const enter = timeAt(mainTimeline, cutFrom - 3, reverse);
        const leave = timeAt(mainTimeline, cutTo + 3, reverse);
        if (enter === null || leave === null) return null;
        const mainLost = downBetween(outages(mainTimeline), enter, leave + 6);
        const baseLost = downBetween(outages(baselineTimeline), enter, leave + 6);
        const stopped = baselineTimeline.some(
          (event) => event.t >= enter && event.t <= leave + 6 && event.app?.safe_stop === true,
        );
        const ours = mainLost < 0.05 ? 'CONTINUA never lost its link' : `CONTINUA lost its link for ${seconds(mainLost)}`;
        const theirs =
          baseLost < 0.05
            ? 'the normal rover kept its link too'
            : `the normal rover was cut off for ${seconds(baseLost)}${stopped ? ' and had to stop' : ''}`;
        return {
          chapter,
          headline: `Through the cutting, ${ours}; ${theirs}.`,
          detail: 'Same road, same signal, same moment. The only difference is how each one prepared.',
        };
      }
      case 'onward': {
        const switches = mainTimeline.reduce(
          (count, event) => count + (actionsOf(event).some((action) => action.kind === 'switch') ? 1 : 0),
          0,
        );
        const ours = main?.app?.session_reconnects ?? 0;
        const theirs = baseline?.app?.session_reconnects ?? 0;
        return {
          chapter,
          headline:
            'Further on, cellular fades too and satellite carries the remote stretch. CONTINUA keeps readying the next network before it is needed.',
          detail: `So far: CONTINUA changed network ${switches} time${switches === 1 ? '' : 's'} and lost its link ${ours} time${ours === 1 ? '' : 's'}; the normal rover lost it ${theirs} time${theirs === 1 ? '' : 's'}.`,
        };
      }
      case 'end':
        return { chapter, headline: 'One run is a story. Here is the proof.', detail: null };
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beat, main, baseline, prepared, toWifi, version, baselineTimeline.length, cutFrom, cutTo, reverse]);

  // --- framing: the beat's shot, eased from the one before it ----------------
  const shot = useMemo<StoryShot | null>(() => {
    if (!beat) return null;
    const previous = ORDER[ORDER.indexOf(beat) - 1];
    return { id: BEATS[beat].shot, at: started, from: previous ? BEATS[previous].shot : null };
  }, [beat, started]);

  // --- pace: slow while the caption is read, then on -----------------------
  let speed = 1;
  if (beat) {
    const spec = BEATS[beat];
    speed = t - started < spec.read * spec.slow ? spec.slow : spec.cruise;
  }

  return { beat, caption, shot, speed, finished: beat === 'end' };
}

// ---------------------------------------------------------------------------
// The story's own controls and caption
// ---------------------------------------------------------------------------

/** The caption: the chapter, one or two sentences, and where its numbers came from. */
export function StoryCaptionCard({ caption }: { caption: StoryCaption }) {
  return (
    <div className="story-caption glass" role="status" aria-live="polite">
      <div className="story-caption-kicker">
        Chapter {caption.chapter} of {CHAPTERS.length} · {CHAPTERS[caption.chapter - 1]}
      </div>
      <p key={caption.headline} className="story-caption-headline drop-in">
        {caption.headline}
      </p>
      {caption.detail && <p className="story-caption-detail">{caption.detail}</p>}
    </div>
  );
}

/** Chapters, transport and the playback rate - slow motion is always labelled. */
export function StoryBar({
  chapter,
  paused,
  speed,
  finished = false,
  onToggle,
  onNext,
  onExit,
  children,
}: {
  chapter: number;
  paused: boolean;
  speed: number;
  /** The run has ended: nothing left to play or skip. */
  finished?: boolean;
  onToggle: () => void;
  onNext: () => void;
  onExit: () => void;
  children?: ReactNode;
}) {
  const rate = speed < 0.98 ? `${speed.toFixed(speed < 0.5 ? 2 : 1)}× slow motion` : speed > 1.02 ? `${speed.toFixed(0)}× faster` : 'real time';
  return (
    <section className="glass flex flex-col gap-2.5 px-4 py-3" aria-label="Story">
      <div className="flex items-center gap-3">
        <ol className="flex min-w-0 flex-1 items-center gap-1.5" aria-label="Chapters">
          {CHAPTERS.map((title, index) => {
            const number = index + 1;
            const state = number < chapter ? 'done' : number === chapter ? 'now' : 'next';
            return (
              <li key={title} className="story-chapter" data-state={state} aria-current={state === 'now' ? 'step' : undefined}>
                <span className="story-chapter-index">{number}</span>
                <span className="story-chapter-title">{title}</span>
              </li>
            );
          })}
        </ol>
        {!finished && (
          <>
            <span
              className="story-rate"
              title="Playback rate of the run. The story slows down while you read, and speeds up between chapters."
            >
              {rate}
            </span>
            <button type="button" className="control w-[104px] shrink-0" onClick={onToggle} aria-label={paused ? 'Play story' : 'Pause story'}>
              {paused ? <PlayIcon size={14} /> : <PauseIcon size={14} />}
              {paused ? 'Play' : 'Pause'}
            </button>
            <button type="button" className="control shrink-0" onClick={onNext} disabled={chapter >= CHAPTERS.length - 1}>
              Next chapter
            </button>
          </>
        )}
        <button type="button" className="icon-btn shrink-0" onClick={onExit} aria-label="Leave the story" title="Leave the story and explore the run yourself">
          <CloseIcon size={15} />
        </button>
      </div>
      {children}
    </section>
  );
}
