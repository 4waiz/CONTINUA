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
import { useMemo, type ReactNode } from 'react';
import { PauseIcon, PlayIcon, ReplayIcon, ResetIcon } from '../ui/icons';

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

function Timeline({
  t,
  duration,
  decisions,
  history,
  latest,
  disabled,
  onSeek,
}: {
  t: number;
  duration: number;
  decisions: EngineEvent[];
  history: EngineEvent[];
  latest: EngineEvent | null;
  disabled: boolean;
  onSeek: (t: number) => void;
}) {
  const segments = useMemo(() => carryingSegments(decisions, history, latest), [decisions, history, latest]);
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
            title: `t+${event.t.toFixed(1)}s · ${actions.map((action) => ACTION_LABEL[action.kind]).join(', ')} - ${event.reason}`,
          },
        ];
      }),
    [decisions],
  );
  const span = duration > 0 ? duration : 1;
  const x = (seconds: number) => `${Math.max(0, Math.min(100, (seconds / span) * 100))}%`;

  return (
    <div className="relative h-[26px] min-w-[180px] flex-1">
      <div className="absolute inset-x-0 top-1/2 h-[6px] -translate-y-1/2 overflow-hidden rounded-full bg-[color:var(--color-line)]">
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
      </div>
      {ticks.map((tick, index) => (
        <span
          key={index}
          aria-hidden
          className="pointer-events-none absolute rounded-full"
          style={{
            left: x(tick.t),
            top: tick.switched ? 1 : 7,
            width: tick.switched ? 3 : 2,
            height: tick.switched ? 24 : 12,
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
  );
}

/** What the timeline's colours mean - the same colours as the links panel. */
function TimelineLegend() {
  const items: { label: string; color: string }[] = [
    { label: 'Wired · Wi-Fi', color: NETWORK_COLOR.wifi },
    { label: 'Cellular', color: NETWORK_COLOR.cellular },
    { label: 'Satellite', color: NETWORK_COLOR.satellite },
    { label: 'No path', color: 'var(--color-bad)' },
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
                {stage.title.toUpperCase()}
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
      <p className="min-w-0 flex-1 truncate text-[12.5px] text-[color:var(--color-muted)]" title={event?.reason}>
        {event?.reason ? (
          <>
            {active && (
              <span className="mr-1.5 hidden font-semibold min-[1600px]:inline" style={{ color: active.color }}>
                {active.blurb}
                <span className="mx-1.5 text-[color:var(--color-line-strong)]">·</span>
              </span>
            )}
            <span className="text-[color:var(--color-ink)]">{event.reason}</span>
          </>
        ) : (
          'The controller reports each stage, and why, once a run is going.'
        )}
      </p>
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
}) {
  return (
    <section className="glass flex flex-col gap-2 px-3 py-2.5" aria-label="Run controls">
      {/* Context: what is running, and what the controller is doing about it. */}
      <div className="flex items-center gap-2.5">
        <select
          className="control min-w-[150px] max-w-[280px] flex-[0_1_270px] truncate"
          title={scenarios.find((entry) => entry.id === scenarioId)?.title}
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
        <select
          className="control w-[150px] shrink-0"
          value={policyId}
          onChange={(event) => onPolicy(event.target.value as PolicyIdString)}
          aria-label="Policy"
          disabled={policies.length === 0}
        >
          {policies.length === 0 && <option> - </option>}
          {policies.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.id}
              {entry.id === 'P1' ? ' · CONTINUA' : entry.id === 'P2' ? ' · CONTINUA P2' : ''}
            </option>
          ))}
        </select>
        {/* A recording's seed is a fact of the recording; there is nothing to type. */}
        <label className="flex shrink-0 items-center gap-1.5 text-[12px] text-[color:var(--color-muted)]" hidden={IS_PUBLIC_PREVIEW}>
          Seed
          <input
            className="control w-[64px] px-2.5"
            type="number"
            min={0}
            max={2147483647}
            value={seed}
            onChange={(event) => onSeed(Number(event.target.value) || 0)}
          />
        </label>
        {!IS_PUBLIC_PREVIEW && (
          <button type="button" className="control control-primary shrink-0" onClick={onStart} disabled={busy}>
            <PlayIcon size={14} /> Start run
          </button>
        )}
        <span className="divider-v mx-1" />
        <Pipeline event={latest} />
      </div>

      {/* Playback: the familiar shape - transport, clock, timeline. */}
      <div className="flex items-center gap-2.5 border-t border-[color:var(--color-line)] pt-2">
        <button
          type="button"
          className="control w-[104px] shrink-0"
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
        <select
          className="control w-[66px] shrink-0 px-2.5"
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
        <span className="metric w-[104px] shrink-0 text-center font-[family-name:var(--font-mono)] text-[12.5px] font-semibold text-[color:var(--color-ink)]">
          {formatClock(t)}
          <span className="text-[color:var(--color-faint)]"> / {formatClock(duration)}</span>
        </span>
        <Timeline
          t={t}
          duration={duration}
          decisions={decisions}
          history={history}
          latest={latest}
          disabled={!runId}
          onSeek={onSeek}
        />
        <TimelineLegend />
        {extra}
      </div>
    </section>
  );
}
