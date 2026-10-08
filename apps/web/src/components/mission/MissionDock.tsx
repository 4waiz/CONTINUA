'use client';

/**
 * The mission dock: everything about *this run* in one strip along the bottom
 * of the scene - what to run, the transport, the timeline, and the
 * Observe -> Predict -> Prepare -> Steer -> Explain spine.
 *
 * The timeline is the one piece of visualisation here, and it is data, not
 * decoration: its track is painted, second by second, with the colour of the
 * link that was carrying the session (from the engine's own events), so the
 * run's handoff story - wired, Wi-Fi, cellular, satellite, and any gap with
 * nothing carrying - is readable at a glance. Ticks mark controller decisions;
 * the tall ones are path switches.
 */

import type { PolicySpec, ScenarioSpec } from '@/lib/api';
import { IS_PUBLIC_PREVIEW } from '@/lib/deployment';
import {
  ACTION_LABEL,
  LINK_LABEL,
  actionsOf,
  type ActionKindId,
  type EngineEvent,
  type PipelineStageId,
  type PolicyIdString,
} from '@continua/contracts/engine';
import { NETWORK_COLOR } from '@continua/scene';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CloseIcon, NetworkIcon, PauseIcon, PlayIcon, ReplayIcon, ResetIcon, SlidersIcon } from '../ui/icons';
import { MAIN_STRATEGIES, NETWORK, plainDecision, readableReason, STRATEGY } from './plain';

const SPEEDS = [0.5, 1, 2, 4, 8] as const;

const STAGES: { id: PipelineStageId; index: string; title: string; blurb: string; color: string }[] = [
  { id: 'observe', index: '01', title: 'Observe', blurb: 'Monitor link quality', color: '#14b8e8' },
  { id: 'predict', index: '02', title: 'Predict', blurb: 'Estimate QoE risk', color: '#1b9df1' },
  { id: 'prepare', index: '03', title: 'Prepare', blurb: 'Warm a backup path', color: '#176bff' },
  { id: 'steer', index: '04', title: 'Steer', blurb: 'Switch or split traffic', color: '#5156e8' },
  { id: 'explain', index: '05', title: 'Explain', blurb: 'Record the decision', color: '#7a3cff' },
];

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

interface Segment {
  from: number;
  to: number;
  link: EngineEvent['carrying'];
}

/**
 * Carrying-path segments over time. Decisions cover the whole run (switches
 * only happen at decisions); the recent history refines it where present.
 */
/** Tick colours for the non-switch decisions the timeline marks. */
const TICK_COLOUR: Partial<Record<ActionKindId, string>> = {
  mode_change: 'var(--color-warn)',
  steer_class: 'var(--color-violet)',
  safe_stop: 'var(--color-bad)',
  resume: 'var(--color-good)',
};

export function carryingSegments(decisions: EngineEvent[], history: EngineEvent[], latest: EngineEvent | null): Segment[] {
  const points = new Map<number, EngineEvent>();
  for (const event of decisions) points.set(event.seq, event);
  for (const event of history) points.set(event.seq, event);
  if (latest) points.set(latest.seq, latest);
  const ordered = [...points.values()].sort((a, b) => a.t - b.t);
  const segments: Segment[] = [];
  for (let i = 0; i < ordered.length; i += 1) {
    const event = ordered[i]!;
    const next = ordered[i + 1];
    const to = next ? next.t : event.t;
    const last = segments[segments.length - 1];
    if (last && last.link === event.carrying && Math.abs(last.to - event.t) < 1e-6) {
      last.to = to;
    } else {
      segments.push({ from: event.t, to, link: event.carrying });
    }
  }
  return segments;
}

/**
 * One run's whole timeline (the scene source keeps every event; the panels'
 * buffers keep only the recent ones), and a counter that changes as it grows.
 */
export interface RunTrack {
  events: readonly EngineEvent[];
  version: number;
}

/**
 * When the session was down, by its receiver: the intervals in which
 * `app.in_outage` held. A link can still be "carrying" while the session is
 * down - a reactive policy keeps the failed link until it notices - so this
 * is drawn over the carrying track, not derived from it.
 */
export function outageSpans(events: readonly EngineEvent[]): { from: number; to: number }[] {
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

function Track({
  segments,
  outages,
  x,
  top,
  height,
}: {
  segments: Segment[];
  outages: { from: number; to: number }[];
  x: (seconds: number) => string;
  top: string;
  height: number;
}) {
  return (
    <div
      className="absolute inset-x-0 overflow-hidden rounded-full bg-[color:var(--color-line)]"
      style={{ top, height }}
    >
      {segments.map((segment, index) => (
        <span
          key={index}
          className="absolute inset-y-0"
          style={{
            left: x(segment.from),
            width: `calc(${x(segment.to)} - ${x(segment.from)})`,
            background: segment.link ? NETWORK_COLOR[segment.link] : 'var(--color-bad)',
            opacity: segment.link ? 1 : 0.8,
          }}
          title={segment.link ? `${LINK_LABEL[segment.link].label} carrying` : 'No carrying path'}
        />
      ))}
      {/* At least two pixels, so a fraction of a second still shows. */}
      {outages.map((span, index) => (
        <span
          key={`o${index}`}
          className="absolute inset-y-0"
          style={{
            left: x(span.from),
            width: `max(2px, calc(${x(span.to)} - ${x(span.from)}))`,
            background: 'var(--color-bad)',
          }}
          title={`Session down ${(span.to - span.from).toFixed(2)} s at t+${span.from.toFixed(1)}s`}
        />
      ))}
    </div>
  );
}

/** A moment worth jumping to: a change of network, or the road map's warning. */
interface Flag {
  t: number;
  label: string;
  title: string;
  color: string;
  link: EngineEvent['carrying'];
}

/**
 * The run's key moments, from its own events: every change of carrying
 * network, and a route-aware policy's preparation for a known gap. Each is a
 * button that jumps the run to just before it.
 */
function flagsOf(events: readonly EngineEvent[]): Flag[] {
  const flags: Flag[] = [];
  let previous: EngineEvent['carrying'] = null;
  let prepared = false;
  for (const event of events) {
    const actions = actionsOf(event);
    const switched = actions.find((action) => action.kind === 'switch');
    if (switched?.link && switched.link !== previous && previous !== null) {
      flags.push({
        t: event.t,
        label: NETWORK[switched.link].name,
        title: plainDecision(event, previous) ?? readableReason(event.reason),
        color: NETWORK_COLOR[switched.link],
        link: switched.link,
      });
    }
    if (!prepared && /^Preparing /.test(event.reason ?? '') && actions.some((action) => action.kind === 'activate_backup')) {
      prepared = true;
      flags.push({
        t: event.t,
        label: 'Gap ahead',
        title: plainDecision(event, previous) ?? readableReason(event.reason),
        color: 'var(--color-violet)',
        link: null,
      });
    }
    if (event.carrying) previous = event.carrying;
  }
  return flags;
}

function Timeline({
  t,
  duration,
  decisions,
  history,
  latest,
  track,
  baseline,
  disabled,
  onSeek,
  deadZoneTimes = [],
  quiet = false,
}: {
  t: number;
  duration: number;
  decisions: EngineEvent[];
  history: EngineEvent[];
  latest: EngineEvent | null;
  /** This run's whole timeline, when the page has it. */
  track?: RunTrack | null;
  /** The reactive baseline's run, drawn as a second track beneath (compare mode). */
  baseline?: RunTrack | null;
  disabled: boolean;
  onSeek: (t: number) => void;
  /** When the rover was in a cutting, from its own distances. */
  deadZoneTimes?: readonly { from: number; to: number }[];
  /** Changes of network as icons alone; only the road map's warning keeps its words. */
  quiet?: boolean;
}) {
  const segments = useMemo(
    () => (track ? carryingSegments([], [...track.events], null) : carryingSegments(decisions, history, latest)),
    // `track.events` grows in place; its version says when.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [track?.events, track?.version, decisions, history, latest],
  );
  const outages = useMemo(
    () => (track ? outageSpans(track.events) : outageSpans(history)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [track?.events, track?.version, history],
  );
  const baselineSegments = useMemo(
    () => (baseline ? carryingSegments([], [...baseline.events], null) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [baseline?.events, baseline?.version],
  );
  const baselineOutages = useMemo(
    () => (baseline ? outageSpans(baseline.events) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [baseline?.events, baseline?.version],
  );
  // Only the decisions that move the session or change how it is driven get a
  // tick. Throttles and duplication windows happen dozens of times a run and
  // turned the track into a hatch; they are all in the Decision Log.
  const ticks = useMemo(
    () =>
      decisions.flatMap((event) => {
        const actions = actionsOf(event);
        const switched = actions.find((action) => action.kind === 'switch');
        const other = actions.find((action) => TICK_COLOUR[action.kind] !== undefined);
        if (!switched && !other) return [];
        return [
          {
            t: event.t,
            switched: Boolean(switched),
            color: switched?.link ? NETWORK_COLOR[switched.link] : TICK_COLOUR[other!.kind]!,
            title: `t+${event.t.toFixed(1)}s · ${actions.map((action) => ACTION_LABEL[action.kind]).join(', ')} - ${readableReason(event.reason)}`,
          },
        ];
      }),
    [decisions],
  );
  const flags = useMemo(
    () => (track ? flagsOf(track.events) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [track?.events, track?.version],
  );
  const span = duration > 0 ? duration : 1;
  const x = (seconds: number) => `${Math.max(0, Math.min(100, (seconds / span) * 100))}%`;
  // The track's width in pixels, so a flag keeps its words only where they fit.
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, []);
  // Which flags keep their words, and which way a label runs: a label is drawn
  // only where it clears the flags around it, and is said on hover otherwise.
  // Quiet, a change of network is its icon alone and the road map's warning
  // runs leftwards from its pin, into the stretch before the gap where nothing
  // else happens.
  const layout = useMemo(() => {
    const iconWidth = 22;
    const labelWidth = (flag: Flag) => 26 + flag.label.length * 6.4;
    const placed = flags.map((flag) => ({ at: (flag.t / span) * width, flag }));
    const out: { labelled: boolean; anchor: 'centre' | 'end' }[] = [];
    let lastRight = -Infinity;
    placed.forEach(({ at, flag }, index) => {
      const warning = flag.link === null;
      const anchor: 'centre' | 'end' = quiet && warning ? 'end' : 'centre';
      const wants = !quiet || warning;
      const full = labelWidth(flag);
      const left = anchor === 'end' ? at - full + 9 : at - full / 2;
      const right = anchor === 'end' ? at + 9 : at + full / 2;
      const next = placed[index + 1];
      const nextLeft = next ? next.at - (next.flag.link === null && quiet ? labelWidth(next.flag) - 9 : iconWidth / 2) : Infinity;
      const labelled = wants && left >= lastRight + 4 && right <= nextLeft - 4;
      out.push({ labelled, anchor: labelled ? anchor : 'centre' });
      lastRight = labelled ? right : at + iconWidth / 2;
    });
    return out;
  }, [flags, span, width, quiet]);

  const split = baselineSegments !== null;
  return (
    <div ref={boxRef} className="relative min-w-[180px] flex-1" style={{ height: flags.length ? 46 : 26 }}>
      {/* Key moments, as buttons above the tracks: jump to just before each. */}
      {flags.length > 0 && (
        <div className="absolute inset-x-0 top-0 h-[18px]" aria-label="Key moments">
          {flags.map((flag, index) => {
            const crowded = layout[index]?.labelled !== true;
            return (
              <button
                key={`${flag.t}-${flag.label}`}
                type="button"
                className="timeline-flag"
                data-compact={crowded}
                data-anchor={layout[index]?.anchor ?? 'centre'}
                style={{ left: x(flag.t), ['--flag' as string]: flag.color }}
                title={`${flag.title} (jump here)`}
                aria-label={`${flag.label}: jump to t+${flag.t.toFixed(0)}s`}
                onClick={() => onSeek(Math.max(0, flag.t - 1.5))}
                disabled={disabled}
              >
                {flag.link ? <NetworkIcon link={flag.link} size={11} /> : <span aria-hidden className="h-[6px] w-[6px] rounded-full bg-current" />}
                {!crowded && flag.label}
              </button>
            );
          })}
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 h-[26px]">
      {deadZoneTimes.map((zone) => (
        <span
          key={zone.from}
          aria-hidden
          className="dead-zone-hatch pointer-events-none absolute inset-y-0 rounded-[4px]"
          style={{ left: x(zone.from), width: `max(3px, calc(${x(zone.to)} - ${x(zone.from)}))`, opacity: 0.7 }}
        />
      ))}
      {split ? (
        <>
          <Track segments={segments} outages={outages} x={x} top="3px" height={8} />
          <Track segments={baselineSegments} outages={baselineOutages} x={x} top="15px" height={8} />
        </>
      ) : (
        <Track segments={segments} outages={outages} x={x} top="10px" height={6} />
      )}
      {ticks.map((tick, index) => (
        <span
          key={index}
          aria-hidden
          className="pointer-events-none absolute rounded-full"
          style={{
            left: x(tick.t),
            top: split ? 0 : tick.switched ? 1 : 7,
            width: tick.switched ? 3 : 2,
            height: split ? 14 : tick.switched ? 24 : 12,
            transform: 'translateX(-50%)',
            background: tick.color,
            opacity: tick.switched ? 1 : 0.55,
            boxShadow: tick.switched ? '0 0 0 2px white' : undefined,
          }}
        />
      ))}
      <input
        type="range"
        className="scrub scrub-overlay absolute inset-0 h-full"
        min={0}
        max={duration}
        step={0.1}
        value={t}
        onChange={(event) => onSeek(Number(event.target.value))}
        disabled={disabled}
        aria-label="Run timeline"
      />
      </div>
    </div>
  );
}

/** What the timeline's colours mean - the same colours as the links panel. */
function TimelineLegend() {
  const items: { label: string; color: string }[] = [
    { label: 'Cable · Wi-Fi', color: NETWORK_COLOR.wifi },
    { label: 'Cellular', color: NETWORK_COLOR.cellular },
    { label: 'Satellite', color: NETWORK_COLOR.satellite },
    { label: 'Link lost', color: 'var(--color-bad)' },
  ];
  return (
    <ul className="hidden shrink-0 items-center gap-2.5 xl:flex" aria-label="Timeline colours: the link carrying the session">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1 text-[11px] font-medium text-[color:var(--color-faint)]">
          <span aria-hidden className="h-[6px] w-[10px] rounded-full" style={{ background: item.color }} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

export function Pipeline({ event }: { event: EngineEvent | null }) {
  const current = event?.stage ?? null;
  const activeIndex = current ? STAGES.findIndex((stage) => stage.id === current) : -1;
  const active = activeIndex >= 0 ? STAGES[activeIndex]! : null;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3" aria-label="Continuity pipeline">
      <ol className="flex shrink-0 items-center gap-1">
        {STAGES.map((stage, index) => {
          const isActive = index === activeIndex;
          const done = activeIndex > index;
          return (
            <li key={stage.id} className="flex items-center gap-1">
              <span
                className="flex h-[26px] items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-semibold transition-colors"
                title={stage.blurb}
                aria-current={isActive ? 'step' : undefined}
                style={{
                  background: isActive ? stage.color : done ? `color-mix(in srgb, ${stage.color} 12%, white)` : 'transparent',
                  color: isActive ? 'white' : done ? stage.color : 'var(--color-faint)',
                  boxShadow: isActive ? `0 4px 12px -4px ${stage.color}` : undefined,
                }}
              >
                <span className="metric text-[11px] opacity-80">{stage.index}</span>
                <span className={isActive ? '' : 'max-[1600px]:hidden'}>{stage.title.toUpperCase()}</span>
              </span>
              {index < STAGES.length - 1 && (
                <span aria-hidden className="text-[11px] text-[color:var(--color-line-strong)]">
                  ›
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <p className="min-w-0 flex-1 truncate text-[12.5px] text-[color:var(--color-muted)]" title={readableReason(event?.reason)}>
        {event?.reason ? (
          <>
            {active && (
              <span className="mr-1.5 hidden font-semibold min-[1600px]:inline" style={{ color: active.color }}>
                {active.blurb}
                <span className="mx-1.5 text-[color:var(--color-line-strong)]">·</span>
              </span>
            )}
            <span className="text-[color:var(--color-ink)]">{readableReason(event.reason)}</span>
          </>
        ) : (
          'The controller reports each stage, and why, once a run is going.'
        )}
      </p>
    </div>
  );
}

/**
 * Everything that chooses a run, in one popover over the bar: what to run,
 * beside what, from which seed, at what speed. Locally it starts the run; on
 * the public build every pairing was recorded ahead of time, so the selection
 * is the run and plays at once.
 */
function RunSettings({
  scenarios,
  policies,
  scenarioId,
  policyId,
  seed,
  compare,
  speed,
  runId,
  busy,
  onScenario,
  onPolicy,
  onSeed,
  onCompare,
  onSpeed,
  onStart,
  onClose,
}: {
  scenarios: ScenarioSpec[];
  policies: PolicySpec[];
  scenarioId: string;
  policyId: PolicyIdString;
  seed: number;
  compare: boolean;
  speed: number;
  runId: string | null;
  busy: boolean;
  onScenario: (id: string) => void;
  onPolicy: (id: PolicyIdString) => void;
  onSeed: (seed: number) => void;
  onCompare: (compare: boolean) => void;
  onSpeed: (speed: number) => void;
  onStart: () => void;
  onClose: () => void;
}) {
  const scenario = scenarios.find((entry) => entry.id === scenarioId);
  return (
    <div className="run-settings glass drop-in" role="dialog" aria-label="Change the run">
      <div className="flex items-center justify-between">
        <span className="section-label">Change the run</span>
        <button type="button" className="run-settings-close" onClick={onClose} aria-label="Close the run settings">
          <CloseIcon size={14} />
        </button>
      </div>
      <label className="run-settings-field">
        <span>Road and signal</span>
        <select
          className="control w-full truncate"
          title={scenario?.title}
          value={scenarioId}
          onChange={(event) => onScenario(event.target.value)}
          aria-label="Scenario"
          disabled={scenarios.length === 0}
        >
          {scenarios.length === 0 && <option>No scenarios - engine offline</option>}
          {scenarios.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.title}
            </option>
          ))}
        </select>
      </label>
      <label className="run-settings-field">
        <span>Strategy</span>
        <select
          className="control w-full"
          value={policyId}
          onChange={(event) => onPolicy(event.target.value as PolicyIdString)}
          aria-label="Policy"
          title={STRATEGY[policyId]?.blurb}
          disabled={policies.length === 0}
        >
          {policies.length === 0 && <option> - </option>}
          {policies.length > 0 && (
            <>
              <optgroup label="Strategies">
                {MAIN_STRATEGIES.filter((id) => policies.some((entry) => entry.id === id)).map((id) => (
                  <option key={id} value={id}>
                    {STRATEGY[id].name} · {id}
                  </option>
                ))}
              </optgroup>
              <optgroup label="For comparison">
                {policies
                  .filter((entry) => !MAIN_STRATEGIES.includes(entry.id))
                  .map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {STRATEGY[entry.id]?.name ?? entry.id} · {entry.id}
                    </option>
                  ))}
              </optgroup>
            </>
          )}
        </select>
        {STRATEGY[policyId] && <span className="run-settings-hint">{STRATEGY[policyId].blurb}</span>}
      </label>
      <label
        className="run-settings-check"
        title="Run the normal rover - switch after it breaks (B0) - on the same scenario, route and seed alongside, and show the two side by side"
      >
        <input
          type="checkbox"
          className="h-[15px] w-[15px] accent-[color:var(--color-blue)]"
          checked={compare}
          onChange={(event) => onCompare(event.target.checked)}
          disabled={policyId === 'B0'}
        />
        <span>
          vs normal rover
          <span className="run-settings-hint">The same road beside a rover that switches only after its network breaks.</span>
        </span>
      </label>
      <div className="flex items-end gap-3">
        {/* A recording's seed is a fact of the recording; there is nothing to type. */}
        {!IS_PUBLIC_PREVIEW && (
          <label className="run-settings-field w-[92px]">
            <span>Seed</span>
            <input
              className="control w-full px-2.5"
              type="number"
              min={0}
              max={2147483647}
              value={seed}
              onChange={(event) => onSeed(Number(event.target.value) || 0)}
            />
          </label>
        )}
        <label className="run-settings-field w-[92px]">
          <span>Speed</span>
          <select
            className="control w-full px-2.5"
            value={speed}
            onChange={(event) => onSpeed(Number(event.target.value))}
            disabled={!runId}
            aria-label="Playback speed"
          >
            {SPEEDS.map((value) => (
              <option key={value} value={value}>
                {value}×
              </option>
            ))}
          </select>
        </label>
        {!IS_PUBLIC_PREVIEW && (
          <button type="button" className="control control-primary ml-auto" onClick={onStart} disabled={busy}>
            <PlayIcon size={14} /> Start run
          </button>
        )}
      </div>
      {IS_PUBLIC_PREVIEW && (
        <p className="run-settings-hint">Every pairing here was recorded by the engine; choosing one plays it.</p>
      )}
    </div>
  );
}

export function MissionDock({
  scenarios,
  policies,
  scenarioId,
  policyId,
  seed,
  onScenario,
  onPolicy,
  onSeed,
  runId,
  playing,
  busy,
  speed,
  t,
  duration,
  latest,
  decisions,
  history,
  onStart,
  onToggle,
  onReset,
  onReplay,
  onSpeed,
  onSeek,
  extra,
  compare,
  onCompare,
  track,
  baseline,
  simple = false,
  detail = false,
  onDetail,
  roadAhead,
  deadZoneTimes,
  settingsOpen = false,
  onSettings,
}: {
  scenarios: ScenarioSpec[];
  policies: PolicySpec[];
  scenarioId: string;
  policyId: PolicyIdString;
  seed: number;
  onScenario: (id: string) => void;
  onPolicy: (id: PolicyIdString) => void;
  onSeed: (seed: number) => void;
  runId: string | null;
  playing: boolean;
  busy: boolean;
  speed: number;
  t: number;
  duration: number;
  latest: EngineEvent | null;
  decisions: EngineEvent[];
  history: EngineEvent[];
  onStart: () => void;
  onToggle: () => void;
  onReset: () => void;
  onReplay: () => void;
  onSpeed: (speed: number) => void;
  onSeek: (t: number) => void;
  extra?: ReactNode;
  /** Whether a run starts with the reactive baseline beside it. */
  compare: boolean;
  onCompare: (compare: boolean) => void;
  /** This run's whole timeline, for its track. */
  track?: RunTrack | null;
  /** The baseline's track, when one is running beside this run. */
  baseline?: RunTrack | null;
  /** Plain words: the timeline's key moments as icons, the legend left out. */
  simple?: boolean;
  /** The expert panels are showing: the road strip and the controller's pipeline join the bar. */
  detail?: boolean;
  onDetail?: (detail: boolean) => void;
  /** The road strip, shown with Details. */
  roadAhead?: ReactNode;
  /** When the rover was in a cutting, for the timeline. */
  deadZoneTimes?: readonly { from: number; to: number }[];
  /** The run's settings popover. */
  settingsOpen?: boolean;
  onSettings?: (open: boolean) => void;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  // The popover closes on Escape and on a press anywhere outside it.
  useEffect(() => {
    if (!settingsOpen || !onSettings) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onSettings(false);
    };
    const onPress = (event: PointerEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) onSettings(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPress);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPress);
    };
  }, [settingsOpen, onSettings]);

  return (
    <section className="glass mission-bar" aria-label="Run controls">
      {detail && (
        <div className="mission-bar-detail">
          {roadAhead && <div>{roadAhead}</div>}
          <Pipeline event={latest} />
        </div>
      )}

      {/* Playback: the familiar shape - transport, clock, timeline. */}
      <div className="mission-bar-row">
        <button
          type="button"
          className="control w-[96px] shrink-0"
          onClick={onToggle}
          disabled={busy || !runId}
          data-active={playing}
        >
          {playing ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
          {playing ? 'Pause' : IS_PUBLIC_PREVIEW ? 'Play' : 'Resume'}
        </button>
        <button
          type="button"
          className="icon-btn shrink-0"
          onClick={onReset}
          disabled={busy || !runId}
          aria-label={IS_PUBLIC_PREVIEW ? 'Restart' : 'Reset'}
          title={IS_PUBLIC_PREVIEW ? 'Restart from the beginning' : 'Reset to the start of the run'}
        >
          <ResetIcon size={16} />
        </button>
        {!IS_PUBLIC_PREVIEW && (
          <button
            type="button"
            className="icon-btn shrink-0"
            onClick={onReplay}
            disabled={busy || !runId}
            aria-label="Replay"
            title="Replay the recorded run, identified as a replay"
          >
            <ReplayIcon size={16} />
          </button>
        )}
        <span className="metric w-[96px] shrink-0 text-center font-[family-name:var(--font-mono)] text-[12.5px] font-semibold text-[color:var(--color-ink)]">
          {formatClock(t)}
          <span className="text-[color:var(--color-faint)]"> / {formatClock(duration)}</span>
        </span>
        {baseline && (
          <span className="flex shrink-0 flex-col self-end pb-[1px] text-right text-[11px] font-semibold leading-[12px]" aria-hidden>
            <span className="text-[color:var(--color-blue)]">CONTINUA</span>
            <span className="text-[color:var(--color-faint)]">Normal</span>
          </span>
        )}
        <Timeline
          t={t}
          duration={duration}
          decisions={decisions}
          history={history}
          latest={latest}
          track={track}
          baseline={baseline}
          disabled={!runId}
          onSeek={onSeek}
          deadZoneTimes={deadZoneTimes}
          quiet={simple}
        />
        {detail && <TimelineLegend />}
        <span className="divider-v mx-0.5" />
        <div className="relative shrink-0" ref={popoverRef}>
          <button
            type="button"
            className="control shrink-0 px-3"
            data-active={settingsOpen}
            aria-expanded={settingsOpen}
            aria-haspopup="dialog"
            aria-label="Change the run"
            onClick={() => onSettings?.(!settingsOpen)}
            title="Choose the road, the strategy and what it is compared with"
          >
            <SlidersIcon size={15} /> <span className="max-[1380px]:hidden">Change the run</span>
          </button>
          {settingsOpen && (
            <RunSettings
              scenarios={scenarios}
              policies={policies}
              scenarioId={scenarioId}
              policyId={policyId}
              seed={seed}
              compare={compare}
              speed={speed}
              runId={runId}
              busy={busy}
              onScenario={onScenario}
              onPolicy={onPolicy}
              onSeed={onSeed}
              onCompare={onCompare}
              onSpeed={onSpeed}
              onStart={() => {
                onStart();
                onSettings?.(false);
              }}
              onClose={() => onSettings?.(false)}
            />
          )}
        </div>
        {onDetail && (
          <button
            type="button"
            className="control shrink-0"
            data-active={detail}
            aria-pressed={detail}
            onClick={() => onDetail(!detail)}
            title="Show every measurement: round trip, loss, jitter, per-class deadlines, the controller's pipeline"
          >
            Details
          </button>
        )}
        {extra && <span className="divider-v mx-0.5" />}
        {extra}
      </div>
    </section>
  );
}
