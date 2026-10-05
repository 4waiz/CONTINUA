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
 * What the story does choose is presentation: the framing, the one caption
 * on screen, and the playback rate. The rate is real time throughout but for
 * one stretch - the cutting, played at half speed so it can be watched - and
 * it is labelled while it lasts, so slow motion is never mistaken for the
 * rover's speed. An earlier cut slowed for every caption and hurried between
 * them; the rover kept surging, and nobody could tell why. The story now ends
 * soon after the cutting, on the stored comparison, instead of fast-forwarding
 * the remote stretch to reach it.
 */

import type { StoryShot, StoryShotId } from '@continua/contracts';
import { actionsOf, type EngineEvent } from '@continua/contracts/engine';
import { route, type DeadZone } from '@continua/scene';
import { useMemo } from 'react';
import { CloseIcon, PauseIcon, PlayIcon } from '../ui/icons';
import { seconds } from './plain';

/** The run the story tells: the shadowed route, CONTINUA with the road map against the normal rover. */
export const STORY_SCENARIO = 'shadow-survey';
export const STORY_POLICY = 'P3' as const;

export const CHAPTERS = ['Leaving the dock', 'Two rovers', 'A dead zone ahead', 'Through the cutting', 'The proof'] as const;

type BeatId = 'dock' | 'wifi' | 'two' | 'ahead' | 'prepare' | 'inside' | 'after' | 'end';

interface Beat {
  id: BeatId;
  /** 1-based chapter. */
  chapter: number;
  shot: StoryShotId;
  /** The playback rate while this beat is on: real time, but for the cutting. */
  speed: number;
}

/** The order the beats come in, for the shot each one eases from. */
const ORDER: readonly BeatId[] = ['dock', 'wifi', 'two', 'ahead', 'prepare', 'inside', 'after', 'end'];

/** The cutting is watched at this rate; everything else is real time. */
export const SLOW_MOTION = 0.5;

const BEATS: Record<BeatId, Beat> = {
  dock: { id: 'dock', chapter: 1, shot: 'dock', speed: 1 },
  wifi: { id: 'wifi', chapter: 1, shot: 'follow', speed: 1 },
  two: { id: 'two', chapter: 2, shot: 'alongside', speed: 1 },
  // Only told if the road map's warning has not come by the time the cutting
  // is this close; normally the warning says it.
  ahead: { id: 'ahead', chapter: 3, shot: 'crane', speed: 1 },
  prepare: { id: 'prepare', chapter: 3, shot: 'crane', speed: 1 },
  inside: { id: 'inside', chapter: 4, shot: 'inside', speed: SLOW_MOTION },
  after: { id: 'after', chapter: 4, shot: 'lead', speed: 1 },
  end: { id: 'end', chapter: 5, shot: 'aerial', speed: 1 },
};

/** How far past the cutting the story runs before it shows the proof, metres. */
const END_AFTER_M = 60;

export interface StoryCaption {
  chapter: number;
  /** One or two short sentences: the only words the story puts on the scene. */
  text: string;
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
    if (completed || (cutTo !== null && position > cutTo + END_AFTER_M)) beat = 'end';
    else if (cutTo !== null && position > cutTo + 3) beat = 'after';
    else if (cutFrom !== null && position >= cutFrom - 3) beat = 'inside';
    else if (prepared && t >= prepared.t) beat = 'prepare';
    else if (cutFrom !== null && position > cutFrom - 40) beat = 'ahead';
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
        return at(cutFrom === null ? null : cutFrom - 40) ?? t;
      case 'prepare':
        return prepared?.t ?? t;
      case 'inside':
        return at(cutFrom === null ? null : cutFrom - 3) ?? t;
      case 'after':
        return at(cutTo === null ? null : cutTo + 3) ?? t;
      case 'end':
        return completed ? (mainTimeline[mainTimeline.length - 1]?.t ?? t) : (at(cutTo === null ? null : cutTo + END_AFTER_M) ?? t);
    }
    return t;
    // Recomputed when the beat changes; `t` is only its fallback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beat, mainTimeline, version, toWifi, prepared, cutFrom, cutTo, reverse, completed]);

  // --- the caption: facts from the two runs at this moment -----------------
  // One or two short sentences, read in the few seconds the beat lasts at
  // real time. Where the facts differ from the story's expectation, the words
  // follow the facts.
  const caption = useMemo<StoryCaption | null>(() => {
    if (!beat) return null;
    const chapter = BEATS[beat].chapter;
    switch (beat) {
      case 'dock':
        return { chapter, text: 'This rescue rover is driven from far away. Its operator must never lose the link.' };
      case 'wifi': {
        // Offline time at the handoff itself: the session's first fifth of a
        // second, before the cable path was up, is the same for both rovers
        // and is not the handoff's.
        const lost = toWifi ? downBetween(outages(mainTimeline), toWifi.t - 1.5, t) : 0;
        return {
          chapter,
          text:
            lost < 0.05
              ? 'Off the cable and straight onto Wi-Fi, without a moment offline.'
              : `Off the cable and onto Wi-Fi, with ${seconds(lost)} offline on the way.`,
        };
      }
      case 'two':
        // The scene draws one rover - the two share every metre of the road -
        // so the caption says where the other one is shown.
        return {
          chapter,
          text: 'A normal rover without CONTINUA drives this same road at the same moment. Its status is beside ours, at the top.',
        };
      case 'ahead':
        return { chapter, text: 'Ahead, a cutting blocks Wi-Fi and cellular. Only satellite gets through.' };
      case 'prepare': {
        const ahead = prepared?.reason.match(/(\d+(?:\.\d+)?)\s*m ahead/);
        return {
          chapter,
          text: `Ahead, a cutting blocks Wi-Fi and cellular. CONTINUA's road map saw it${
            ahead ? ` ${Number(ahead[1]).toFixed(0)} m out` : ''
          } and is warming up satellite.`,
        };
      }
      case 'inside': {
        const baseDown = baseline?.app?.in_outage === true;
        const mainOnSatellite = main?.app ? !main.app.in_outage && main.carrying === 'satellite' : false;
        // Its operator view shows the video waiting while the link holds;
        // the caption says so rather than leave it to look like a failure.
        const videoPaused = main?.app?.classes.video?.stalled_now === true;
        const ours = mainOnSatellite
          ? videoPaused
            ? 'CONTINUA is on satellite and still connected, though its video pauses on the thinner link.'
            : 'CONTINUA is on satellite and still connected.'
          : null;
        let text = 'The banks close in: Wi-Fi and cellular fade out.';
        if (ours && baseDown) text = `${ours} The normal rover has lost its link.`;
        else if (ours) text = `Wi-Fi and cellular are gone. ${ours}`;
        else if (baseDown) text = 'Wi-Fi and cellular are gone, and the normal rover has lost its link.';
        return { chapter, text };
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
            ? 'The normal rover kept its link too.'
            : `The normal rover was cut off for ${seconds(baseLost)}${stopped ? ' and had to stop' : ''}.`;
        return { chapter, text: `Through the cutting, ${ours}. ${theirs}` };
      }
      case 'end':
        return { chapter, text: 'One run is a story. Here is the proof.' };
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

  // --- pace: real time, but for the cutting ---------------------------------
  const speed = beat ? BEATS[beat].speed : 1;

  return { beat, caption, shot, speed, finished: beat === 'end' };
}

// ---------------------------------------------------------------------------
// The story's bar: where it is, what to notice, and the transport - one row
// ---------------------------------------------------------------------------

/**
 * Everything the story says sits in this one bar under the scene: the
 * chapter, one caption, and the transport. Nothing else covers the picture.
 */
export function StoryBar({
  caption,
  chapter,
  paused,
  speed,
  onToggle,
  onNext,
  onExit,
}: {
  caption: StoryCaption | null;
  chapter: number;
  paused: boolean;
  speed: number;
  onToggle: () => void;
  onNext: () => void;
  onExit: () => void;
}) {
  const slow = speed < 0.98;
  const fast = speed > 1.02;
  return (
    <section className="story-bar glass" aria-label="Story">
      <div className="story-bar-where">
        <ol className="story-steps" aria-label={`Chapter ${chapter} of ${CHAPTERS.length}`}>
          {CHAPTERS.map((title, index) => {
            const number = index + 1;
            const state = number < chapter ? 'done' : number === chapter ? 'now' : 'next';
            return <li key={title} className="story-step" data-state={state} title={title} aria-current={state === 'now' ? 'step' : undefined} />;
          })}
        </ol>
        <div className="story-bar-chapter">{CHAPTERS[chapter - 1]}</div>
      </div>
      <p key={caption?.text} className="story-bar-caption drop-in" role="status" aria-live="polite">
        {caption?.text}
      </p>
      {(slow || fast) && (
        <span
          className="story-rate"
          title="The playback rate. The story plays in real time, but for the cutting, which it plays at half speed."
        >
          {slow ? `Slow motion · ${speed === 0.5 ? '½' : speed.toFixed(2)}×` : `${speed.toFixed(0)}× faster`}
        </span>
      )}
      <button type="button" className="icon-btn shrink-0" onClick={onToggle} aria-label={paused ? 'Play story' : 'Pause story'} title={paused ? 'Play' : 'Pause'}>
        {paused ? <PlayIcon size={15} /> : <PauseIcon size={15} />}
      </button>
      <button type="button" className="control shrink-0" onClick={onNext} disabled={chapter >= CHAPTERS.length - 1} title="Skip to the next chapter">
        Next
      </button>
      <button type="button" className="icon-btn shrink-0" onClick={onExit} aria-label="Leave the story" title="Leave the story and explore the run yourself">
        <CloseIcon size={15} />
      </button>
    </section>
  );
}
