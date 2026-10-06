/**
 * The interface in plain words.
 *
 * The engine speaks in policy ids, link phases and controller reasons written
 * for an engineer ("Moved the session from wifi to cellular on a predicted
 * violation: RTT 14 ms, loss 5.1 %"). Someone seeing CONTINUA for the first
 * time needs the same facts in words they already have: which network the
 * rover is on, whether the operator can still reach it, and why it just did
 * what it did.
 *
 * Nothing here adds a fact. Every sentence is built from fields of an engine
 * event - the actions it records, the links it names, the numbers in its
 * reason - and anything that cannot be read from the event is left out rather
 * than guessed. The engine's own wording stays one click away (Details, the
 * Decision Log).
 */

import {
  actionsOf,
  type ControlModeId,
  type EngineEvent,
  type EngineLinkId,
  type LinkPhase,
  type PolicyIdString,
  type TrafficClassId,
} from '@continua/contracts/engine';

/** Each strategy the engine can run, as someone new to it would say it. */
export const STRATEGY: Record<PolicyIdString, { name: string; who: string; blurb: string }> = {
  B0: {
    name: 'Switch after it breaks',
    who: 'Normal rover',
    blurb: 'One network at a time; it moves only once that network has failed. What a session does without CONTINUA.',
  },
  B1: {
    name: 'Backup after trouble',
    who: 'Backup-after-trouble rover',
    blurb: 'Starts a second network once trouble is measured on the first.',
  },
  B2: {
    name: 'Every network on, always',
    who: 'Everything-on rover',
    blurb: 'Keeps every network running and sends everything twice - safe, and expensive.',
  },
  'B2-defer': {
    name: 'Every network on, uploads wait',
    who: 'Everything-on rover',
    blurb: 'Every network running, but big uploads wait while the connection is under strain.',
  },
  P1: {
    name: 'CONTINUA',
    who: 'CONTINUA',
    blurb: 'Watches every network, readies the next one before it is needed, and moves before the old one fails.',
  },
  'P1-noPred': {
    name: 'CONTINUA without trend forecast',
    who: 'CONTINUA (no forecast)',
    blurb: 'For comparison: CONTINUA with its trend forecast switched off.',
  },
  'P1-noApp': {
    name: 'CONTINUA without app priorities',
    who: 'CONTINUA (no app priorities)',
    blurb: 'For comparison: CONTINUA treating every kind of traffic the same.',
  },
  P2: {
    name: 'CONTINUA + per-app routing',
    who: 'CONTINUA P2',
    blurb: 'CONTINUA, plus each kind of traffic on its own best network and a safer driving mode when the link is slow.',
  },
  'P2-noSteer': {
    name: 'CONTINUA P2 without per-app routing',
    who: 'CONTINUA P2 (no routing)',
    blurb: 'For comparison: P2 with per-app routing switched off.',
  },
  'P2-noMode': {
    name: 'CONTINUA P2 without driving modes',
    who: 'CONTINUA P2 (no modes)',
    blurb: 'For comparison: P2 that always drives remotely.',
  },
  'P2-reactiveMode': {
    name: 'CONTINUA P2, late mode changes',
    who: 'CONTINUA P2 (late modes)',
    blurb: 'For comparison: P2 that changes driving mode only after a problem is measured.',
  },
  P3: {
    name: 'CONTINUA + road map',
    who: 'CONTINUA',
    blurb: 'CONTINUA, plus a map of where each network drops out along the road: it readies the next network before a known dead zone.',
  },
};

/** The strategies a first-time visitor chooses between; the rest are for comparison. */
export const MAIN_STRATEGIES: readonly PolicyIdString[] = ['P3', 'P1', 'B0', 'B2', 'B2-defer'];

export function strategyName(id: string): string {
  return STRATEGY[id as PolicyIdString]?.name ?? id;
}

/** The networks, by the name a visitor would use. */
export const NETWORK: Record<EngineLinkId, { name: string; the: string }> = {
  wired: { name: 'Cable', the: 'the cable' },
  wifi: { name: 'Wi-Fi', the: 'Wi-Fi' },
  cellular: { name: 'Cellular', the: 'the cellular network' },
  satellite: { name: 'Satellite', the: 'satellite' },
};

/** What each link is doing, in words. */
export const PHASE_WORDS: Record<LinkPhase, { label: string; tone: 'good' | 'ready' | 'busy' | 'idle' | 'off' }> = {
  carrying: { label: 'Carrying the connection', tone: 'good' },
  active: { label: 'Ready as backup', tone: 'ready' },
  activating: { label: 'Starting up', tone: 'busy' },
  validating: { label: 'Checking it works', tone: 'busy' },
  available: { label: 'In range, switched off', tone: 'idle' },
  unavailable: { label: 'Out of reach', tone: 'off' },
};

export const MODE_WORDS: Record<ControlModeId, { label: string; blurb: string }> = {
  teleop: { label: 'Remote driving', blurb: 'The operator steers it live.' },
  waypoint: { label: 'Waypoint driving', blurb: 'The link is slow, so it drives itself between points the operator sets.' },
  safe_hold: { label: 'Stopped safely', blurb: 'No usable connection: it holds still until one comes back.' },
};

const CLASS_WORDS: Record<TrafficClassId, string> = {
  control: 'steering commands',
  telemetry: 'sensor readings',
  video: 'the video',
  voice: 'the voice channel',
  bulk: 'big uploads',
};

const linkName = (link: string | null | undefined): string =>
  link && link in NETWORK ? NETWORK[link as EngineLinkId].the : 'another network';

/** A number written in a reason, e.g. "unavailable 79 m ahead" -> 79. */
function numberBefore(reason: string, unit: string): number | null {
  const match = reason.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${unit}`));
  return match ? Number(match[1]) : null;
}

/**
 * One controller decision as a sentence. `previous` is the link that was
 * carrying before this event, for a switch's "from". Null when the event
 * records no action worth telling.
 */
export function plainDecision(event: EngineEvent, previous: EngineLinkId | null): string | null {
  const actions = actionsOf(event);
  const reason = event.reason ?? '';
  const switched = actions.find((action) => action.kind === 'switch');
  if (switched?.link) {
    const from = previous && previous !== switched.link ? linkName(previous) : null;
    const to = linkName(switched.link);
    if (/became unusable/.test(reason)) return `${capitalise(from ?? 'the old network')} stopped working, so the connection moved to ${to}.`;
    if (/predicted violation/.test(reason)) return `Moved the connection to ${to} before ${from ?? 'the old network'} could fail.`;
    if (/measured violation/.test(reason)) return `${capitalise(from ?? 'the old network')} got too slow, so the connection moved to ${to}.`;
    return `Moved the connection${from ? ` from ${from}` : ''} to ${to}.`;
  }
  // The road map's warning is the decision that starts a network for the gap.
  // Later decisions give the same reason for what they hold back meanwhile;
  // they are said as what they do, below.
  const backup = actions.find((action) => action.kind === 'activate_backup');
  if (/^Preparing /.test(reason) && backup?.link) {
    const ahead = numberBefore(reason, 'm ahead');
    return `Dead zone ${ahead !== null ? `${ahead.toFixed(0)} m ` : ''}ahead on the road map: starting ${linkName(backup.link)} now, so it is ready in time.`;
  }
  const kinds = new Set(actions.map((action) => action.kind));
  if (kinds.has('safe_stop')) return 'No network can carry the connection: the rover stops safely and waits.';
  if (kinds.has('resume')) return 'A connection is back: the rover drives on.';
  if (kinds.has('mode_change')) {
    const mode = event.control_mode ? MODE_WORDS[event.control_mode].label.toLowerCase() : null;
    return mode ? `Changed to ${mode}.` : 'Changed how the rover is driven.';
  }
  const activated = actions.find((action) => action.kind === 'activate_backup');
  if (activated?.link) return `Starting ${linkName(activated.link)} as a backup.`;
  const released = actions.find((action) => action.kind === 'release_backup');
  if (released?.link) return `Switched ${linkName(released.link)} off: not needed now.`;
  const steered = actions.find((action) => action.kind === 'steer_class');
  if (steered?.traffic_class && steered.link) {
    return `Moved ${CLASS_WORDS[steered.traffic_class]} to ${linkName(steered.link)}.`;
  }
  if (kinds.has('throttle_class')) {
    const cls = actions.find((action) => action.kind === 'throttle_class')?.traffic_class;
    return `Held back ${cls ? CLASS_WORDS[cls] : 'low-priority traffic'} to keep the important traffic moving.`;
  }
  if (kinds.has('restore_class')) return 'Room again: the held-back traffic resumes.';
  if (kinds.has('start_duplication')) return 'Sending the steering commands on two networks at once, to be safe.';
  if (kinds.has('stop_duplication')) return 'Back to one network for the steering commands.';
  return null;
}

/**
 * Why a change of network happened, in a few words - the second line of the
 * moment banner. Read from the engine's recorded reason; null when the reason
 * says nothing a visitor would recognise.
 */
export function handoffWhy(event: EngineEvent, previous: EngineLinkId | null): string | null {
  const reason = event.reason ?? '';
  const from = previous ? NETWORK[previous].name : null;
  if (/became unusable/.test(reason)) return from ? `${from} stopped working` : 'The old network stopped working';
  if (/predicted violation/.test(reason)) return from ? `Before ${from} could fail` : 'Before the old network could fail';
  if (/measured violation/.test(reason)) return from ? `${from} got too slow` : 'The old network got too slow';
  if (/^Preparing /.test(reason)) return 'Ready before the dead zone';
  return null;
}

/**
 * The road map's warning, as the banner says it: where the gap is, and what
 * CONTINUA is doing about it. Null for any other decision.
 */
export function warningWords(event: EngineEvent): { title: string; detail: string; link: EngineLinkId } | null {
  const reason = event.reason ?? '';
  const backup = actionsOf(event).find((action) => action.kind === 'activate_backup');
  if (!/^Preparing /.test(reason) || !backup?.link) return null;
  const ahead = numberBefore(reason, 'm ahead');
  return {
    title: ahead !== null ? `Dead zone ${ahead.toFixed(0)} m ahead` : 'Dead zone ahead',
    detail: `The road map saw it coming: starting ${NETWORK[backup.link].name.toLowerCase()} now, so it is ready in time.`,
    link: backup.link,
  };
}

/**
 * What the voice says while driving - the short words already on screen, so a
 * run of changes close together, as at the cutting, is still said as it
 * happens. The reasons stay in the dock's last decision, to read.
 */
export const spokenLines = {
  /** The handoff toast: "Moved to Satellite". */
  movedTo: (link: EngineLinkId): string => `Moved to ${NETWORK[link].name}.`,
  /** The road strip, while the road map's warning stands. */
  gapAhead: 'Gap ahead: getting satellite ready.',
  /** A status card turning red, or green again. */
  connection: (rover: string, up: boolean): string => (up ? `${rover}: connected again.` : `${rover}: connection lost.`),
  /** The viewer takes the wheel, and hands it back. */
  tookWheel: 'You have the wheel.',
  handedBack: 'Autopilot. The recording drives on from here.',
} as const;

/** The connection as the operator experiences it, from the receiver's report. */
export function connectionState(event: EngineEvent | null | undefined): {
  up: boolean | null;
  label: string;
  detail: string;
} {
  const app = event?.app;
  if (!event || !app) return { up: null, label: 'Waiting', detail: 'no run yet' };
  if (app.in_outage) {
    return {
      up: false,
      label: 'Connection lost',
      detail: app.safe_stop ? 'the rover has stopped safely' : 'the operator cannot reach the rover',
    };
  }
  const via = event.carrying ? NETWORK[event.carrying].name : null;
  return { up: true, label: 'Connected', detail: via ? `via ${via}` : 'connected' };
}

/**
 * An engine reason as recorded, with a missing measurement said as one. The
 * controller formats an absent round trip or loss as "nan" in a few of its
 * sentences; the recording is evidence and stays as it is, and on screen a
 * value that does not exist reads "unavailable", never as a number.
 */
export function readableReason(reason: string | null | undefined): string {
  return (reason ?? '').replace(/\bRTT nan ms\b/g, 'RTT unavailable').replace(/\bloss nan %/g, 'loss unavailable');
}

export function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Seconds, as a person reads them: "0.2 s", "3.8 s", "1 min 05 s". */
export function seconds(value: number): string {
  if (value < 60) return `${value < 10 ? value.toFixed(1) : value.toFixed(0)} s`;
  const minutes = Math.floor(value / 60);
  return `${minutes} min ${String(Math.round(value - minutes * 60)).padStart(2, '0')} s`;
}
