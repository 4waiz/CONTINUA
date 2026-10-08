/**
 * What the voice says while a run plays: a running commentary built from the
 * two runs' own events - the run on screen and, when it is compared, the
 * normal rover beside it.
 *
 * It used to say three things: "Moved to Wi-Fi", "Gap ahead" and "connection
 * lost / connected again". It now says why a switch happened, what the road
 * map saw coming, when a rover is cut off and what it was missing, how long
 * the normal rover stood, and how the run ended. Every sentence is built from
 * fields of the events - the actions recorded, the links named, the numbers
 * in a reason, the receiver's own outage flag - or from the scenario's dead
 * zones, which the scene draws as walls; a fact the events do not hold is left
 * out, not guessed. Nothing here is a measurement the engine did not make.
 *
 * A pure function of the timelines, so the page and `scripts/voice-lines-drive.mts`
 * (which records every line the recorded runs can produce) always agree on
 * the words. No browser or scene imports for the same reason.
 */

import { actionsOf, CONTROL_MODES, type EngineEvent, type EngineLinkId } from '@continua/contracts/engine';
import { MODE_WORDS, NETWORK, seconds } from './plain';

/** A dead zone as the scene has it (`deadZonesFromFaults`): where the scenario shadows links. */
export interface ZoneLike {
  readonly from: number;
  readonly to: number;
  readonly ramp: number;
  readonly links: readonly string[];
}

export interface CommentaryLine {
  /** Run time the line becomes due, seconds. */
  readonly at: number;
  readonly text: string;
  /** When lines queue, the higher is said first. */
  readonly priority: number;
  /** Run seconds after `at` the line is still worth saying. */
  readonly keep: number;
  /** The fact it reports, stable as the timeline grows: each is said once. */
  readonly key: string;
}

export interface CommentaryInput {
  /** The run on screen, its events so far. */
  readonly main: readonly EngineEvent[];
  /** What the voice calls it: "CONTINUA", "Everything-on rover", ... */
  readonly mainName: string;
  /** The normal rover's events so far, when it drives beside the run. */
  readonly baseline: readonly EngineEvent[] | null;
  readonly zones: readonly ZoneLike[];
  readonly reverse: boolean;
  /** The route's length, metres, for a reversed run's place on it. */
  readonly routeLength: number;
  /** The run has finished: its summary is due. */
  readonly completed: boolean;
}

const NORMAL = 'Normal rover';

/** A name at the start of a sentence: "CONTINUA", "The normal rover". */
function subject(name: string): string {
  return name.startsWith('CONTINUA') ? name : `The ${name.charAt(0).toLowerCase()}${name.slice(1)}`;
}

/** A name inside a sentence: "CONTINUA", "the normal rover". */
function object(name: string): string {
  return name.startsWith('CONTINUA') ? name : `the ${name.charAt(0).toLowerCase()}${name.slice(1)}`;
}

function networkName(link: string | null | undefined, start = false): string {
  if (!link || !(link in NETWORK)) return start ? 'Another network' : 'another network';
  const name = link === 'wired' ? (start ? 'The cable' : 'the cable') : NETWORK[link as EngineLinkId].name;
  return start || link === 'wifi' || link === 'wired' ? name : name.toLowerCase();
}

function joined(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function times(n: number): string {
  return n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`;
}

interface Span {
  from: number;
  /** When it ended; null while it is still down at the newest event. */
  to: number | null;
  /** The engine declared the session lost and the rover stopped (`app.safe_stop`). */
  stopped: boolean;
  /**
   * It began before the rover first moved: the session's first fifth of a
   * second before the cable path is up, or - starting far from the dock - the
   * wait for a first link. Every rover has it, parked; it is counted in the
   * run's summary but not announced as a loss.
   */
  parked: boolean;
}

/** The stretches the receiver reported the session down (`app.in_outage`). */
function downSpans(events: readonly EngineEvent[]): Span[] {
  const spans: Span[] = [];
  let departed = false;
  let open: Span | null = null;
  for (const event of events) {
    const down = event.app?.in_outage === true;
    if (down && !open) open = { from: event.t, to: null, stopped: false, parked: !departed };
    if (open && down && event.app?.safe_stop) open.stopped = true;
    if (!down && open) {
      open.to = event.t;
      spans.push(open);
      open = null;
    }
    if ((event.vehicle?.distance_m ?? 0) > 0.05) departed = true;
  }
  if (open) spans.push(open);
  return spans;
}

/** The last event at or before `t`. */
function eventAt(events: readonly EngineEvent[], t: number): EngineEvent | null {
  let low = 0;
  let high = events.length - 1;
  if (high < 0 || events[0]!.t > t) return null;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (events[mid]!.t <= t + 1e-6) low = mid;
    else high = mid - 1;
  }
  return events[low]!;
}

function upAt(events: readonly EngineEvent[], t: number): boolean {
  const event = eventAt(events, t);
  return event?.app ? event.app.in_outage !== true : false;
}

/** Whether the session stayed up from `from` to `to`, by every event between. */
function upThroughout(events: readonly EngineEvent[], from: number, to: number): boolean {
  for (const event of events) {
    if (event.t < from - 1e-6) continue;
    if (event.t > to + 1e-6) break;
    if (event.app?.in_outage) return false;
  }
  return upAt(events, from);
}

function lastT(events: readonly EngineEvent[]): number {
  return events.length ? events[events.length - 1]!.t : 0;
}

/** Lines about one rover losing its link and getting it back. */
function outageLines(
  out: CommentaryLine[],
  events: readonly EngineEvent[],
  name: string,
  other: { events: readonly EngineEvent[]; name: string } | null,
  role: 'main' | 'base',
): void {
  const newest = lastT(events);
  for (const span of downSpans(events)) {
    if (span.parked) continue;
    const key = `${role}-down-${span.from}`;
    const before = eventAt(events, span.from - 0.05);
    const atLoss = eventAt(events, span.from);
    const switched = atLoss ? actionsOf(atLoss).find((action) => action.kind === 'switch') : undefined;
    const previous = before?.carrying ?? null;
    const next = switched?.link ?? atLoss?.carrying ?? null;
    const length = (span.to ?? newest) - span.from;

    // A blip, said once it is over: how long, and on the way to what.
    if (span.to !== null && length < 2) {
      if (length < 0.3) continue;
      const context =
        previous === 'wired' ? ' coming off the cable' : next && next !== previous ? ` moving to ${networkName(next)}` : '';
      const contrast = other && upThroughout(other.events, span.from, span.to) ? ` ${subject(other.name)} didn't.` : '';
      out.push({
        at: span.to,
        text: `${subject(name)} lost its link for ${seconds(length)}${context}.${contrast}`,
        priority: 4,
        keep: 5,
        key,
      });
      continue;
    }
    // Not yet known to be more than a blip: the same two seconds a finished
    // one is judged by, so a run as it plays says what its recording says.
    if (span.to === null && length < 2) continue;

    // A real loss: what dropped, and what was not ready to take over.
    const nextPhase = next && atLoss ? atLoss.links[next as EngineLinkId]?.phase : null;
    const notReady = nextPhase === 'available' || nextPhase === 'activating' || nextPhase === 'validating';
    const cause =
      previous && next && previous !== next && notReady
        ? ` ${networkName(previous, true)} dropped and ${networkName(next)} wasn't ready.`
        : previous
          ? ` ${networkName(previous, true)} dropped.`
          : '';
    const otherUp = other && upAt(other.events, span.from + 0.8) ? ` ${subject(other.name)} is still connected.` : '';
    out.push({
      at: span.from + 2,
      text: `${name}: connection lost.${cause}${otherUp}`,
      priority: 5,
      keep: 6,
      key: `${key}-lost`,
    });
    if (span.to !== null) {
      const back = eventAt(events, span.to);
      const via = back?.carrying ? `, on ${networkName(back.carrying)}` : '';
      out.push({
        at: span.to,
        text: `${name}: back after ${seconds(length)}${span.stopped ? ' stopped' : ''}${via}.`,
        priority: 5,
        keep: 8,
        key: `${key}-back`,
      });
    }
  }
}

/** Why the run's rover changed network, in a sentence a visitor can follow. */
function switchLine(event: EngineEvent, previous: string | null, name: string, up: boolean): string | null {
  const switched = actionsOf(event).find((action) => action.kind === 'switch');
  const to = switched?.link;
  if (!to || to === previous) return null;
  const reason = event.reason ?? '';
  const gap = up ? ' with no gap' : '';
  if (previous === 'wired') return `Off the cable: ${object(name)} is on ${networkName(to)}${up ? ', with no gap' : ''}.`;
  if (/became unusable/.test(reason)) return `${networkName(previous, true)} dropped out. ${subject(name)} moved to ${networkName(to)}${gap}.`;
  if (/predicted violation/.test(reason)) return `${subject(name)} moved to ${networkName(to)} before ${networkName(previous)} could fail.`;
  if (/measured violation/.test(reason)) return `${networkName(previous, true)} got too slow, so ${object(name)} moved to ${networkName(to)}.`;
  if (/^Preparing /.test(reason)) return `${subject(name)} moved to ${networkName(to)}, ready before the dead zone.`;
  return `${subject(name)} moved to ${networkName(to)}.`;
}

function position(event: EngineEvent, reverse: boolean, length: number): number | null {
  const d = event.vehicle?.distance_m;
  if (d === undefined) return null;
  return reverse ? length - d : d;
}

export function driveCommentary(input: CommentaryInput): CommentaryLine[] {
  const { main, mainName, baseline, zones, reverse, routeLength, completed } = input;
  const out: CommentaryLine[] = [];
  if (main.length === 0) return out;

  // --- two rovers, one road ----------------------------------------------------
  if (baseline) {
    out.push({
      at: 0.6,
      text: `Two rovers, one road: ${object(mainName)} in white, and a normal rover in grey beside it.`,
      priority: 2,
      keep: 4,
      key: 'intro',
    });
  }
  const departed = main.find((event) => (event.vehicle?.distance_m ?? 0) > 0.5);
  if (departed) {
    const cabled = departed.carrying === 'wired' && (!baseline || eventAt(baseline, departed.t)?.carrying === 'wired');
    out.push({
      at: departed.t,
      text: baseline
        ? `Both leave the dock${cabled ? ', still on the cable' : ''}.`
        : `${subject(mainName)} leaves the dock${cabled ? ', still on the cable' : ''}.`,
      priority: 2,
      keep: 3,
      key: 'depart',
    });
  }

  // --- the run's own rover: each change of network, the road map, its modes ------
  const mainSpans = downSpans(main);
  let warned: { link: string; at: number } | null = null;
  let readySaid = false;
  for (let i = 0; i < main.length; i += 1) {
    const event = main[i]!;
    const previous = main[i - 1]?.carrying ?? null;
    const up = !mainSpans.some((span) => span.from <= event.t + 0.5 && (span.to ?? Infinity) >= event.t - 0.3);
    const line = switchLine(event, previous, mainName, up);
    if (line) out.push({ at: event.t, text: line, priority: 3, keep: 3.5, key: `switch-${event.seq}` });

    const backup = actionsOf(event).find((action) => action.kind === 'activate_backup');
    if (!warned && backup?.link && /^Preparing /.test(event.reason ?? '')) {
      const ahead = (event.reason ?? '').match(/(\d+(?:\.\d+)?)\s*m ahead/);
      warned = { link: backup.link, at: event.t };
      out.push({
        at: event.t,
        text: `Dead zone ${ahead ? `${Number(ahead[1]).toFixed(0)} m ` : ''}ahead on the road map. ${subject(mainName)} is starting ${networkName(backup.link)} now.`,
        priority: 4,
        keep: 5,
        key: 'warning',
      });
    }
    if (warned && !readySaid && event.t > warned.at) {
      const phase = event.links[warned.link as EngineLinkId]?.phase;
      if (phase === 'active' || phase === 'carrying') {
        readySaid = true;
        out.push({
          at: event.t,
          text: `${networkName(warned.link, true)} is up and ready, before the dead zone.`,
          priority: 2,
          keep: 3,
          key: 'ready',
        });
      }
    }

    const mode = actionsOf(event).find((action) => action.kind === 'mode_change');
    const modeId = event.control_mode;
    if (mode && modeId && (CONTROL_MODES as readonly string[]).includes(modeId)) {
      const words = MODE_WORDS[modeId];
      out.push({
        at: event.t,
        text:
          modeId === 'safe_hold'
            ? `${subject(mainName)} stops safely. ${words.blurb}`
            : `${subject(mainName)} switches to ${words.label.toLowerCase()}. ${words.blurb}`,
        priority: 2,
        keep: 3,
        key: `mode-${event.seq}`,
      });
    }
  }

  // --- the dead zones: in and out, from the rover's own place on the route --------
  zones.forEach((zone, index) => {
    const enter = reverse ? zone.to + zone.ramp / 2 : zone.from - zone.ramp / 2;
    const leave = reverse ? zone.from - zone.ramp / 2 : zone.to + zone.ramp / 2;
    const reached = (event: EngineEvent, place: number) => {
      const at = position(event, reverse, routeLength);
      return at !== null && (reverse ? at <= place : at >= place);
    };
    const into = main.find((event) => reached(event, enter));
    const names = zone.links.filter((link) => link in NETWORK).map((link, i) => networkName(link, i === 0));
    if (into && names.length > 0) {
      out.push({
        at: into.t,
        text: names.length > 1 ? `Into the cutting: ${joined(names)} fade out.` : `${names[0]} is shadowed on this stretch.`,
        priority: 1,
        keep: 2,
        key: `zone-in-${index}`,
      });
    }
    const outOf = main.find((event) => reached(event, leave));
    if (outOf && names.length > 1) {
      out.push({ at: outOf.t, text: 'Out of the cutting.', priority: 1, keep: 2, key: `zone-out-${index}` });
    }
  });

  // --- losing the link and getting it back, either rover --------------------------
  const pair = baseline ? { events: baseline, name: NORMAL } : null;
  outageLines(out, main, mainName, pair, 'main');
  if (baseline) outageLines(out, baseline, NORMAL, { events: main, name: mainName }, 'base');

  // --- the honest cost: video pausing on a thin link, though the link holds -------
  let pauses = 0;
  let lastPause = -Infinity;
  let stalledSince: number | null = null;
  for (const event of main) {
    const stalled = event.app?.classes.video?.stalled_now === true && event.app?.in_outage !== true;
    if (!stalled) {
      stalledSince = null;
      continue;
    }
    stalledSince ??= event.t;
    if (event.t - stalledSince >= 1.5 && event.t - lastPause > 20 && pauses < 2 && event.carrying) {
      pauses += 1;
      lastPause = event.t;
      out.push({
        at: event.t,
        text: `${subject(mainName)}'s video pauses on the thinner ${networkName(event.carrying)} link, but the link holds.`,
        priority: 1,
        keep: 3,
        key: `video-${stalledSince}`,
      });
    }
  }

  // --- what the normal rover does that the run's rover does not -------------------
  if (baseline) {
    for (let i = 1; i < main.length; i += 1) {
      const event = main[i]!;
      const switched = actionsOf(event).find((action) => action.kind === 'switch');
      if (!switched?.link || main[i - 1]!.carrying !== 'satellite' || switched.link === 'satellite') continue;
      const theirs = eventAt(baseline, event.t);
      if (theirs?.carrying === 'satellite' && theirs.app && !theirs.app.in_outage) {
        out.push({
          at: event.t + 0.1,
          text: 'The normal rover stays on satellite: it only moves when its network fails.',
          priority: 2,
          keep: 4,
          key: 'stays',
        });
      }
      break;
    }
  }

  // --- how it ended ------------------------------------------------------------------
  if (completed) {
    const summary = (events: readonly EngineEvent[]) => {
      const spans = downSpans(events).filter((span) => span.to !== null && span.to - span.from >= 0.3);
      if (spans.length === 0) return 'was never cut off';
      const total = spans.reduce((sum, span) => sum + (span.to! - span.from), 0);
      return `was cut off ${times(spans.length)}, ${seconds(total)} in all`;
    };
    out.push({
      at: lastT(main),
      text: baseline
        ? `Run complete. ${subject(mainName)} ${summary(main)}. The normal rover ${summary(baseline)}.`
        : `Run complete. ${subject(mainName)} ${summary(main)}.`,
      priority: 6,
      keep: 12,
      key: 'end',
    });
  }

  return out.sort((a, b) => a.at - b.at || b.priority - a.priority);
}
