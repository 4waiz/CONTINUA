'use client';

/**
 * Decision Log - the audit trail.
 *
 * Every row is an action the controller actually took, with the observations it
 * was based on, the policy version and which predictor produced the prediction.
 * These were written at decision time and read back from the run's JSONL file;
 * none of it is reconstructed after the fact.
 */

import { api, EngineApiError, type RunRow } from '@/lib/api';
import {
  ACTION_LABEL,
  CONTROL_MODE_LABEL,
  CONTROLLER_STATE_LABEL,
  LINK_IDS,
  LINK_LABEL,
  POLICY_NAME,
  STAGE_LABEL,
  TRAFFIC_CLASSES,
  actionsOf,
  classPathOf,
  controlModeOf,
  parseEngineEvent,
  type ActionKindId,
  type EngineAction,
  type EngineEvent,
  type PolicyIdString,
} from '@continua/contracts/engine';
import { IS_PUBLIC_PREVIEW } from '@/lib/deployment';
import { NETWORK_COLOR } from '@continua/scene';
import Link from 'next/link';
import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { AppShell } from './AppShell';
import { carryingSegments } from './mission/MissionDock';
import { readableReason } from './mission/plain';
import { NetworkIcon, ReplayIcon } from './ui/icons';
import { Chip } from './ui/primitives';

type Filter = 'key' | 'actions' | 'all';

const FILTERS: readonly { value: Filter; label: string; title: string }[] = [
  {
    value: 'key',
    label: 'Handoffs',
    title: 'Path switches, control-mode changes, class steering, safe stops and resumes.',
  },
  { value: 'actions', label: 'All actions', title: 'Every decision at which the controller acted.' },
  { value: 'all', label: 'All events', title: 'Every recorded event, including the ones with no action.' },
];

/** The decisions that change where the session or a class rides, or how it is driven. */
const KEY_KINDS: ReadonlySet<ActionKindId> = new Set(['switch', 'mode_change', 'steer_class', 'safe_stop', 'resume']);

/** Which action names a row when one decision took several. */
const PRIORITY: readonly ActionKindId[] = [
  'safe_stop',
  'switch',
  'mode_change',
  'steer_class',
  'resume',
  'activate_backup',
  'validate_backup',
  'start_duplication',
  'stop_duplication',
  'release_backup',
  'throttle_class',
  'restore_class',
  'none',
];

function primaryAction(actions: EngineAction[]): EngineAction | null {
  let best: EngineAction | null = null;
  let rank = Number.POSITIVE_INFINITY;
  for (const action of actions) {
    const index = PRIORITY.indexOf(action.kind);
    if (index !== -1 && index < rank) {
      rank = index;
      best = action;
    }
  }
  return best;
}

export function DecisionLogView() {
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [pickedRunId, setPickedRunId] = useState<string | null>(null);
  // The loaded payload carries the run id it belongs to, so "still loading" is
  // derived rather than tracked with a flag set synchronously from an effect.
  const [loaded, setLoaded] = useState<{
    runId: string;
    events: EngineEvent[];
    metrics: Record<string, unknown> | null;
  } | null>(null);
  const [selected, setSelected] = useState<EngineEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('key');

  // Scenarios by the name the rest of the interface uses, not their ids.
  const [scenarioTitles, setScenarioTitles] = useState<Record<string, string>>({});
  useEffect(() => {
    api
      .scenarios()
      .then((r) => setScenarioTitles(Object.fromEntries(r.scenarios.map((entry) => [entry.id, entry.title]))))
      .catch(() => undefined);
  }, []);
  const titleOf = (id: string) => scenarioTitles[id] ?? id;

  useEffect(() => {
    api
      .listRuns(60)
      .then((r) => setRuns(r.runs))
      .catch((cause: unknown) =>
        setError(cause instanceof EngineApiError ? cause.message : 'Engine unreachable.'),
      );
  }, []);

  // Default to the newest run that actually recorded events - a controller's
  // run before a baseline's: Mission records the reactive baseline beside
  // every run, usually a moment later, and a baseline's log is three handoffs
  // and nothing it decided. Derived rather than assigned from an effect, so
  // the first render already has a selection.
  const recorded = runs.filter((row) => row.events > 0);
  const runId =
    pickedRunId ?? (recorded.find((row) => !row.policy_id.startsWith('B')) ?? recorded[0])?.run_id ?? null;

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    // Everything is written after the await, so nothing sets state synchronously
    // inside the effect body.
    Promise.all([api.getRunEvents(runId, 0, 6000), api.getRunMetrics(runId).catch(() => null)])
      .then(([payload, runMetrics]) => {
        if (cancelled) return;
        const parsed = payload.events
          .map((raw) => parseEngineEvent(raw))
          .filter((event): event is EngineEvent => event !== null);
        setLoaded({ runId, events: parsed, metrics: runMetrics });
        setSelected(null);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setLoaded({ runId, events: [], metrics: null });
        setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  const events = useMemo(() => (loaded?.runId === runId ? loaded.events : []), [loaded, runId]);
  const metrics = loaded?.runId === runId ? loaded.metrics : null;
  const loading = runId !== null && loaded?.runId !== runId;

  const rows = useMemo(() => {
    if (filter === 'all') return events;
    if (filter === 'actions') return events.filter((event) => actionsOf(event).length > 0);
    return events.filter((event) => actionsOf(event).some((action) => KEY_KINDS.has(action.kind)));
  }, [events, filter]);

  const counts = useMemo(() => {
    const tally = { switch: 0, activate_backup: 0, start_duplication: 0, mode_change: 0, steer_class: 0 };
    for (const event of events) {
      for (const action of actionsOf(event)) {
        if (action.kind in tally) tally[action.kind as keyof typeof tally] += 1;
      }
    }
    return tally;
  }, [events]);

  const run = runs.find((row) => row.run_id === runId) ?? null;
  const duration = Math.max(run?.duration_s ?? 0, events.length ? events[events.length - 1]!.t : 0, 1);

  const select = (event: EngineEvent | null) => {
    setSelected(event);
    if (!event) return;
    // Bring the row into view when the selection came from the ribbon or the keyboard.
    requestAnimationFrame(() =>
      document.getElementById(`decision-${event.seq}`)?.scrollIntoView({ block: 'nearest' }),
    );
  };

  const selectNearest = (t: number) => {
    if (rows.length === 0) return;
    let best = rows[0]!;
    for (const row of rows) if (Math.abs(row.t - t) < Math.abs(best.t - t)) best = row;
    select(best);
  };

  const onListKey = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const index = selected ? rows.findIndex((row) => row.seq === selected.seq) : -1;
    const next = event.key === 'ArrowDown' ? Math.min(rows.length - 1, index + 1) : Math.max(0, index - 1);
    const target = rows[next];
    if (target) {
      select(target);
      document.getElementById(`decision-${target.seq}`)?.querySelector('button')?.focus();
    }
  };

  return (
    <AppShell>
      <div className="grid h-full min-h-0 grid-cols-1 grid-rows-[minmax(0,1fr)] gap-3 xl:grid-cols-[264px_minmax(0,1fr)_372px] max-[1500px]:xl:grid-cols-[240px_minmax(0,1fr)_340px]">
        {/* ---------------- runs ---------------- */}
        <section className="panel flex min-h-0 flex-col overflow-hidden">
          <header className="flex items-center justify-between gap-2 px-4 pt-3.5 pb-2.5">
            <h2 className="section-label">Recorded runs</h2>
            {runs.length > 0 && (
              <span className="metric text-[11px] font-semibold text-[color:var(--color-faint)]">{runs.length}</span>
            )}
          </header>
          {error && <p className="mx-4 mb-2 text-[11.5px] text-[color:var(--color-bad)]">{error}</p>}
          {runs.length === 0 ? (
            <p className="px-4 text-[12px] leading-snug text-[color:var(--color-muted)]">
              No runs recorded yet. Start one from Mission.
            </p>
          ) : (
            <ul className="scroll-y flex-1 px-2 pb-2" aria-label="Recorded runs">
              {runs.map((row) => (
                <li key={row.run_id}>
                  <RunItem
                    row={row}
                    title={titleOf(row.scenario_id)}
                    active={row.run_id === runId}
                    onPick={() => setPickedRunId(row.run_id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ---------------- timeline ---------------- */}
        <section className="panel flex min-h-0 flex-col overflow-hidden">
          <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-[color:var(--color-line)] px-5 pt-3.5 pb-3">
            <div className="min-w-0">
              <h2 className="section-label">Decisions</h2>
              <p className="mt-1 truncate text-[15px] font-semibold tracking-[-0.01em]">
                {run ? (
                  <>
                    <span title={run.scenario_id}>{titleOf(run.scenario_id)}</span>
                    <span className="font-medium text-[color:var(--color-muted)]">
                      {' '}
                      · {POLICY_NAME[run.policy_id as PolicyIdString] ?? run.policy_id}
                    </span>
                  </>
                ) : (
                  'No run selected'
                )}
              </p>
            </div>
            <div role="group" aria-label="Which decisions to list" className="seg shrink-0">
              {FILTERS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className="seg-item !h-[28px] !px-3 !text-[12.5px]"
                  title={option.title}
                  data-active={filter === option.value}
                  aria-pressed={filter === option.value}
                  onClick={() => setFilter(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {events.length > 0 && (
              <>
                <dl className="flex w-full flex-wrap gap-x-5 gap-y-1 text-[12px]">
                  <Tally label="Path switches" value={counts.switch} />
                  <Tally label="Backup activations" value={counts.activate_backup} />
                  <Tally label="Duplication windows" value={counts.start_duplication} />
                  <Tally label="Mode changes" value={counts.mode_change} />
                  <Tally label="Class steers" value={counts.steer_class} />
                </dl>
                <CarryingRibbon
                  events={events}
                  duration={duration}
                  selected={selected}
                  rows={rows}
                  onPick={selectNearest}
                />
              </>
            )}
          </header>

          {loading ? (
            <div className="flex flex-col gap-2 p-5" aria-label="Loading decisions">
              {[0, 1, 2, 3, 4].map((index) => (
                <div key={index} className="loading-sweep relative h-[46px] overflow-hidden rounded-[12px] bg-[color:var(--color-surface-muted)]" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <p className="p-5 text-[12px] text-[color:var(--color-muted)]">
              {runId
                ? `No ${filter === 'all' ? 'events' : filter === 'actions' ? 'actions' : 'handoffs'} recorded for this run.`
                : 'Pick a recorded run.'}
            </p>
          ) : (
            <ul className="scroll-y flex-1 px-3 py-2" aria-label="Decision timeline" onKeyDown={onListKey}>
              {rows.map((event, index) => (
                <DecisionRow
                  key={event.seq}
                  event={event}
                  active={selected?.seq === event.seq}
                  first={index === 0}
                  last={index === rows.length - 1}
                  onSelect={() => setSelected(event)}
                />
              ))}
            </ul>
          )}
        </section>

        {/* ---------------- detail ---------------- */}
        <div className="scroll-y flex min-h-0 flex-col gap-3 pr-0.5">
          <section className="panel px-5 py-4">
            {!selected ? (
              <>
                <h2 className="section-label">Decision detail</h2>
                <p className="mt-2 text-[12px] leading-snug text-[color:var(--color-muted)]">
                  Select a decision to see the observations it was based on. ↑ ↓ step through the list.
                </p>
              </>
            ) : (
              <DecisionDetail event={selected} />
            )}
          </section>

          {metrics && <RunOutcome metrics={metrics} />}
        </div>
      </div>
    </AppShell>
  );
}

// ---------------------------------------------------------------------------

function RunItem({ row, title, active, onPick }: { row: RunRow; title: string; active: boolean; onPick: () => void }) {
  const started = new Date(row.started_at);
  const when = Number.isNaN(started.getTime())
    ? row.started_at
    : started.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return (
    <button
      type="button"
      onClick={onPick}
      aria-current={active}
      className="relative flex w-full flex-col gap-1 rounded-[12px] px-3 py-2.5 text-left transition-colors hover:bg-[color:var(--color-surface-muted)]"
      style={{ background: active ? 'color-mix(in srgb, var(--color-blue) 8%, white)' : undefined }}
    >
      {active && (
        <span aria-hidden className="absolute top-2.5 bottom-2.5 left-0 w-[3px] rounded-full bg-[color:var(--color-blue)]" />
      )}
      <span className="flex w-full items-center justify-between gap-2">
        <span
          className="truncate text-[13px] font-semibold"
          style={{ color: active ? 'var(--color-blue)' : undefined }}
          title={row.scenario_id}
        >
          {title}
        </span>
        <span
          className="shrink-0 rounded-full bg-[color:var(--color-surface-muted)] px-2 py-[1px] text-[11px] font-semibold text-[color:var(--color-muted)]"
          title={POLICY_NAME[row.policy_id as PolicyIdString] ?? row.policy_id}
        >
          {row.policy_id}
        </span>
      </span>
      <span className="flex w-full items-center justify-between gap-2 text-[11px] text-[color:var(--color-faint)]">
        <span className="truncate">
          {when} · {row.mode}
        </span>
        <span className="metric shrink-0">{row.events.toLocaleString()} ev</span>
      </span>
    </button>
  );
}

function Tally({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dd className="metric text-[13px] font-semibold">{value}</dd>
      <dt className="text-[color:var(--color-muted)]">{label.toLowerCase()}</dt>
    </div>
  );
}

/**
 * Which link carried the session over the whole run, painted from the recorded
 * events - the same colours as the Mission timeline. Dragging it selects the
 * nearest listed decision.
 */
function CarryingRibbon({
  events,
  rows,
  duration,
  selected,
  onPick,
}: {
  events: EngineEvent[];
  rows: EngineEvent[];
  duration: number;
  selected: EngineEvent | null;
  onPick: (t: number) => void;
}) {
  const segments = useMemo(() => carryingSegments(events, [], null), [events]);
  const ticks = useMemo(
    () =>
      rows
        .map((event) => ({ t: event.t, action: primaryAction(actionsOf(event)) }))
        .filter((tick) => tick.action && KEY_KINDS.has(tick.action.kind)),
    [rows],
  );
  const x = (seconds: number) => `${Math.max(0, Math.min(100, (seconds / duration) * 100))}%`;
  const legend = useMemo(() => {
    const items: { label: string; color: string }[] = [];
    for (const link of LINK_IDS) {
      if (!segments.some((segment) => segment.link === link)) continue;
      const same = items.find((item) => item.color === NETWORK_COLOR[link]);
      if (same) same.label = `${same.label} · ${LINK_LABEL[link].label}`;
      else items.push({ label: LINK_LABEL[link].label, color: NETWORK_COLOR[link] });
    }
    if (segments.some((segment) => segment.link === null)) items.push({ label: 'No path', color: 'var(--color-bad)' });
    return items;
  }, [segments]);

  return (
    <div className="flex w-full items-center gap-3">
      <div className="relative h-[26px] min-w-0 flex-1">
        <div className="absolute inset-x-0 top-1/2 h-[8px] -translate-y-1/2 overflow-hidden rounded-full bg-[color:var(--color-line)]">
          {segments.map((segment, index) => (
            <span
              key={index}
              className="absolute inset-y-0"
              style={{
                left: x(segment.from),
                width: `calc(${x(segment.to)} - ${x(segment.from)})`,
                background: segment.link ? NETWORK_COLOR[segment.link] : 'var(--color-bad)',
              }}
            />
          ))}
        </div>
        {ticks.map((tick, index) => (
          <span
            key={index}
            aria-hidden
            className="pointer-events-none absolute top-[2px] h-[22px] w-[2px] -translate-x-1/2 rounded-full"
            style={{ left: x(tick.t), background: nodeStyle(tick.action).color, boxShadow: '0 0 0 1.5px white' }}
          />
        ))}
        <input
          type="range"
          className="scrub scrub-overlay absolute inset-0 h-full"
          min={0}
          max={duration}
          step={0.1}
          value={selected?.t ?? 0}
          onChange={(event) => onPick(Number(event.target.value))}
          aria-label="Jump to a time in the run"
          title="Carrying link over the run. Drag to jump to the nearest decision."
        />
      </div>
      <ul className="flex shrink-0 items-center gap-2.5" aria-label="Ribbon colours: the link carrying the session">
        {legend.map((item) => (
          <li key={item.label} className="flex items-center gap-1 text-[11px] font-medium text-[color:var(--color-muted)]">
            <span aria-hidden className="h-[6px] w-[10px] rounded-full" style={{ background: item.color }} />
            {item.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** How a timeline node looks: what kind of decision it was, in the colour of the link it concerned. */
function nodeStyle(action: EngineAction | null): { color: string; size: number; hollow: boolean } {
  if (!action || action.kind === 'none') return { color: 'var(--color-line-strong)', size: 7, hollow: false };
  const link = action.link ? NETWORK_COLOR[action.link] : null;
  switch (action.kind) {
    case 'switch':
      return { color: link ?? 'var(--color-blue)', size: 13, hollow: false };
    case 'safe_stop':
      return { color: 'var(--color-bad)', size: 12, hollow: false };
    case 'resume':
      return { color: 'var(--color-good)', size: 11, hollow: false };
    case 'mode_change':
      return { color: 'var(--color-warn)', size: 11, hollow: false };
    case 'steer_class':
      return { color: 'var(--color-violet)', size: 11, hollow: false };
    case 'activate_backup':
    case 'validate_backup':
    case 'release_backup':
    case 'start_duplication':
    case 'stop_duplication':
      return { color: link ?? 'var(--color-faint)', size: 10, hollow: true };
    default:
      return { color: 'var(--color-faint)', size: 8, hollow: false };
  }
}

/** A short sentence for one action - what the controller did, to what. */
function describeAction(action: EngineAction): string {
  const link = action.link ? LINK_LABEL[action.link].label : '';
  const cls = action.traffic_class ?? '';
  switch (action.kind) {
    case 'switch':
      return `Switched to ${link}`;
    case 'activate_backup':
      return `Activated ${link} as backup`;
    case 'validate_backup':
      return `Validated ${link} backup`;
    case 'release_backup':
      return `Released ${link} backup`;
    case 'start_duplication':
      return cls ? `Duplicating ${cls}${link ? ` on ${link}` : ''}` : `Started duplication${link ? ` on ${link}` : ''}`;
    case 'stop_duplication':
      return cls ? `Stopped duplicating ${cls}` : 'Stopped duplication';
    case 'throttle_class':
      return `Throttled ${cls}`;
    case 'restore_class':
      return `Restored ${cls}`;
    case 'mode_change': {
      const from = String(action.detail.from ?? '');
      const to = String(action.detail.to ?? '');
      return `Mode ${from} → ${to}`;
    }
    case 'steer_class':
      return `Steered ${cls} to ${link}`;
    default:
      return ACTION_LABEL[action.kind];
  }
}

function DecisionRow({
  event,
  active,
  first,
  last,
  onSelect,
}: {
  event: EngineEvent;
  active: boolean;
  first: boolean;
  last: boolean;
  onSelect: () => void;
}) {
  const actions = actionsOf(event);
  const primary = primaryAction(actions);
  const node = nodeStyle(primary);
  const title = primary ? describeAction(primary) : `${STAGE_LABEL[event.stage]} · no action`;
  const more = Math.max(0, actions.length - 1);
  const emphatic = primary !== null && KEY_KINDS.has(primary.kind);

  return (
    <li id={`decision-${event.seq}`}>
      <button
        type="button"
        onClick={onSelect}
        aria-current={active}
        className="grid w-full grid-cols-[58px_22px_minmax(0,1fr)] gap-x-2.5 rounded-[12px] pr-3 text-left transition-colors hover:bg-[color:var(--color-surface-muted)] focus-visible:outline-2 focus-visible:outline-[color:var(--color-blue)]"
        style={{ background: active ? 'color-mix(in srgb, var(--color-blue) 7%, white)' : undefined }}
      >
        <span className="metric pt-[11px] text-right font-[family-name:var(--font-mono)] text-[11.5px] text-[color:var(--color-faint)]">
          {event.t.toFixed(1)}s
        </span>
        <span aria-hidden className="relative flex justify-center">
          <span
            className="absolute left-1/2 w-px -translate-x-1/2 bg-[color:var(--color-line-strong)]"
            style={{ top: first ? 18 : 0, bottom: last ? 'calc(100% - 18px)' : 0 }}
          />
          <span
            className="relative rounded-full"
            style={{
              marginTop: 18 - node.size / 2,
              width: node.size,
              height: node.size,
              background: node.hollow ? 'white' : node.color,
              boxShadow: node.hollow
                ? `inset 0 0 0 2px ${node.color}, 0 0 0 2px white`
                : `0 0 0 2px white${emphatic ? `, 0 0 0 5px color-mix(in srgb, ${node.color} 22%, transparent)` : ''}`,
            }}
          />
        </span>
        <span className="min-w-0 py-2">
          <span className="flex items-center gap-2">
            <span
              className="truncate text-[13px] font-semibold"
              style={{ color: primary?.kind === 'switch' && primary.link ? NETWORK_COLOR[primary.link] : undefined }}
            >
              {title}
            </span>
            {more > 0 && (
              <span className="shrink-0 text-[11px] font-medium text-[color:var(--color-faint)]">+{more} more</span>
            )}
            <span className="metric ml-auto shrink-0 text-[11px] text-[color:var(--color-faint)]">#{event.seq}</span>
          </span>
          <span
            className={`mt-0.5 block text-[12px] leading-snug ${emphatic ? 'text-[color:var(--color-ink)]' : 'text-[color:var(--color-muted)]'}`}
          >
            {readableReason(event.reason)}
          </span>
        </span>
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------

function DecisionDetail({ event }: { event: EngineEvent }) {
  const actions = actionsOf(event);
  return (
    <div className="flex flex-col gap-4 text-[12px]">
      <header className="flex items-center justify-between gap-2">
        <h2 className="section-label">Decision #{event.seq}</h2>
        <span className="metric font-[family-name:var(--font-mono)] text-[12px] font-semibold">t+{event.t.toFixed(2)}s</span>
      </header>

      <div className="-mt-2 flex flex-wrap items-center gap-1.5">
        <Chip tone="blue">{STAGE_LABEL[event.stage]}</Chip>
        <Chip tone="muted">{CONTROLLER_STATE_LABEL[event.controller_state]}</Chip>
        {event.carrying && (
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[11px] font-semibold"
            style={{
              color: NETWORK_COLOR[event.carrying],
              background: `color-mix(in srgb, ${NETWORK_COLOR[event.carrying]} 10%, white)`,
            }}
            title="The link carrying the session once this decision was applied. The observations below were taken before it."
          >
            <NetworkIcon link={event.carrying} size={13} /> session on {LINK_LABEL[event.carrying].label}
          </span>
        )}
      </div>

      <div>
        <div className="section-label">Reason recorded at decision time</div>
        <p className="mt-1.5 text-[13px] leading-snug font-medium">{readableReason(event.reason)}</p>
        {/* The recording replays through the same engine; the public build has
            no engine to start one, so the link is local-only. */}
        {!IS_PUBLIC_PREVIEW && (
          <Link
            href={`/?replay=${encodeURIComponent(event.run_id)}&t=${event.t.toFixed(1)}`}
            className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-semibold text-[color:var(--color-blue)] no-underline hover:underline"
            title="Opens Mission and replays this recorded run from a few seconds before this decision."
          >
            <ReplayIcon size={14} /> Replay in 3D from t+{Math.max(0, event.t - 4).toFixed(0)}s
          </Link>
        )}
      </div>

      {actions.length > 0 && (
        <div>
          <div className="section-label">Actions, in the order they were taken</div>
          <ol className="mt-1.5 flex flex-col gap-1">
            {actions.map((action, index) => {
              const node = nodeStyle(action);
              return (
                <li key={`${action.kind}-${index}`} className="rounded-[10px] bg-[color:var(--color-surface-muted)] px-2.5 py-1.5">
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="h-[8px] w-[8px] shrink-0 rounded-full"
                      style={{
                        background: node.hollow ? 'white' : node.color,
                        boxShadow: node.hollow ? `inset 0 0 0 2px ${node.color}` : undefined,
                      }}
                    />
                    <span className="font-semibold">{describeAction(action)}</span>
                    {action.kind === 'mode_change' && (
                      <span className="text-[11px] text-[color:var(--color-muted)]">
                        {String(action.detail.trigger ?? '')}
                        {action.detail.anticipated === true ? ' · anticipated' : ''}
                      </span>
                    )}
                    <span className="metric ml-auto text-[11px] text-[color:var(--color-faint)]">{index + 1}</span>
                  </div>
                  {typeof action.detail.reason === 'string' && action.detail.reason !== event.reason && (
                    <p className="mt-1 pl-4 text-[11.5px] leading-snug text-[color:var(--color-muted)]">{readableReason(action.detail.reason)}</p>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Fact label="Command mode">{CONTROL_MODE_LABEL[controlModeOf(event)]}</Fact>
        <Fact label="Policy" mono title={`${event.policy_id} · ${event.policy_version}`}>
          {event.policy_id} · {event.policy_version}
        </Fact>
        <Fact label="Predictor" mono title={event.prediction?.predictor}>
          {event.prediction?.predictor ?? 'none'}
        </Fact>
        <Fact label="Wall clock" mono>
          {new Date(event.wall_clock).toLocaleTimeString(undefined, { hour12: false })}
        </Fact>
      </dl>

      <div>
        <div className="section-label">Class paths</div>
        {event.carrying ? (
          <ul className="mt-1.5 flex flex-wrap gap-1">
            {TRAFFIC_CLASSES.map((cls) => {
              const path = classPathOf(event, cls);
              return (
                <li
                  key={cls}
                  className="flex items-center gap-1 rounded-full bg-[color:var(--color-surface-muted)] py-[3px] pr-2.5 pl-2 text-[11.5px]"
                >
                  <span className="font-medium">{cls}</span>
                  <span className="text-[color:var(--color-faint)]">→</span>
                  <span className="font-semibold" style={{ color: path ? NETWORK_COLOR[path] : undefined }}>
                    {path ? LINK_LABEL[path].label : 'none'}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-1.5 text-[color:var(--color-muted)]">No carrying path at this instant.</p>
        )}
      </div>

      {event.prediction && (
        <div className="rounded-[12px] bg-[color:var(--color-surface-muted)] p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="section-label">Prediction</span>
            <Chip tone={event.prediction.violation_expected ? 'violet' : 'muted'}>
              {event.prediction.violation_expected ? 'violation expected' : 'no violation expected'}
            </Chip>
          </div>
          <p className="mt-1.5 text-[11.5px] text-[color:var(--color-muted)]">
            Horizon {event.prediction.horizon_s}s
            {event.prediction.score !== null && (
              <span
                title={
                  event.prediction.calibrated
                    ? 'Calibrated probability.'
                    : 'Uncalibrated score - deliberately not labelled a probability.'
                }
              >
                {' '}
                · score {event.prediction.score}
                {event.prediction.calibrated ? '' : ' (uncalibrated)'}
              </span>
            )}
          </p>
          <details className="mt-1.5">
            <summary className="cursor-pointer text-[11.5px] font-medium text-[color:var(--color-blue)]">Features used</summary>
            <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
              {Object.entries(event.prediction.features).map(([key, value]) => (
                <div key={key} className="flex justify-between gap-1">
                  <dt className="truncate text-[color:var(--color-muted)]">{key}</dt>
                  <dd className="metric">{value}</dd>
                </div>
              ))}
            </dl>
          </details>
        </div>
      )}

      <div>
        <div className="section-label">Observations at that instant</div>
        <table className="mt-1.5 w-full border-collapse text-[11.5px]">
          <thead>
            <tr className="text-left text-[11px] text-[color:var(--color-faint)]">
              <th className="pb-1 font-medium">Link</th>
              <th className="pb-1 font-medium">Phase</th>
              <th className="pb-1 text-right font-medium">RTT</th>
              <th className="pb-1 text-right font-medium">Loss</th>
              <th className="pb-1 text-right font-medium">Rate</th>
            </tr>
          </thead>
          <tbody>
            {LINK_IDS.map((link) => {
              const obs = event.links[link];
              const carrying = obs?.phase === 'carrying';
              return (
                <tr key={link} className="border-t border-[color:var(--color-line)]">
                  <td className="py-1.5">
                    <span className="flex items-center gap-1.5 font-semibold" style={{ color: carrying ? NETWORK_COLOR[link] : undefined }}>
                      <span style={{ color: NETWORK_COLOR[link] }}>
                        <NetworkIcon link={link} size={13} />
                      </span>
                      {LINK_LABEL[link].label}
                    </span>
                  </td>
                  <td className="py-1.5 text-[color:var(--color-muted)]">{obs?.phase ?? 'not reported'}</td>
                  <td className="metric py-1.5 text-right">
                    <Measured value={obs?.rtt_ms} format={(v) => `${v.toFixed(0)} ms`} />
                  </td>
                  <td className="metric py-1.5 text-right">
                    <Measured value={obs?.loss_pct} format={(v) => `${v.toFixed(1)} %`} />
                  </td>
                  <td className="metric py-1.5 text-right">
                    <Measured value={obs?.throughput_mbps} format={(v) => `${v.toFixed(1)} Mb/s`} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-1.5 text-[11px] text-[color:var(--color-faint)]">
          — means unavailable: no acknowledged samples at that instant. It is not zero.
        </p>
      </div>
    </div>
  );
}

function Fact({
  label,
  mono = false,
  title,
  children,
}: {
  label: string;
  mono?: boolean;
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="section-label">{label}</dt>
      <dd
        title={title}
        className={`mt-1 truncate font-semibold ${mono ? 'metric font-[family-name:var(--font-mono)] text-[11.5px]' : 'text-[12.5px]'}`}
      >
        {children}
      </dd>
    </div>
  );
}

/** A measurement, or a dash that says it does not exist - never a zero. */
function Measured({ value, format }: { value: number | null | undefined; format: (value: number) => string }) {
  if (value === null || value === undefined) {
    return (
      <span className="text-[color:var(--color-faint)]" title="unavailable">
        —
      </span>
    );
  }
  return <>{format(value)}</>;
}

// ---------------------------------------------------------------------------

function read(source: Record<string, unknown>, path: string): unknown {
  let node: unknown = source;
  for (const key of path.split('.')) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

function num(source: Record<string, unknown>, path: string): number | null {
  const value = read(source, path);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function bytes(value: number | null): string | null {
  if (value === null) return null;
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)} GB`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)} MB`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(0)} kB`;
  return `${value} B`;
}

/**
 * What the run measured, from the metrics file the engine wrote when it ended.
 * A field the file does not have is shown as unavailable; the full file stays
 * one click away.
 */
function RunOutcome({ metrics }: { metrics: Record<string, unknown> }) {
  const handovers = num(metrics, 'control_plane.handovers');
  const unnecessary = num(metrics, 'control_plane.unnecessary_handovers');
  const interruptions = num(metrics, 'continuity.interruptions');
  const interruptionS = num(metrics, 'continuity.total_interruption_s');
  const precision = num(metrics, 'prediction.precision');
  const recall = num(metrics, 'prediction.recall');
  const rows: { label: string; value: string | null; hint?: string }[] = [
    {
      label: 'Interruptions',
      value:
        interruptions === null
          ? null
          : `${interruptions}${interruptionS !== null ? ` · ${interruptionS.toFixed(2)} s` : ''}`,
      hint: 'Count, then total time with no usable carrying path.',
    },
    { label: 'Session reconnects', value: num(metrics, 'continuity.session_reconnects')?.toString() ?? null },
    {
      label: 'Handovers',
      value: handovers === null ? null : `${handovers}${unnecessary !== null ? ` · ${unnecessary} unnecessary` : ''}`,
    },
    { label: 'Backup activations', value: num(metrics, 'control_plane.backup_activations')?.toString() ?? null },
    {
      label: 'App health',
      value: num(metrics, 'app_health_score')?.toFixed(0) ?? null,
      hint: 'Application-health score over the run, 0-100, from receiver-side class outcomes.',
    },
    { label: 'Satellite bytes', value: bytes(num(metrics, 'links.satellite_bytes')) },
    {
      label: 'Overhead',
      value: num(metrics, 'links.overhead_pct') === null ? null : `${num(metrics, 'links.overhead_pct')!.toFixed(1)} %`,
      hint: 'Bytes sent beyond goodput: duplicates, probes and retransmissions.',
    },
    {
      label: 'Prediction P / R',
      value: precision === null || recall === null ? null : `${precision.toFixed(2)} / ${recall.toFixed(2)}`,
      hint: String(read(metrics, 'prediction.scoring_rule') ?? 'Precision and recall of the predictor over this run.'),
    },
  ];
  return (
    <section className="panel px-5 py-4">
      <header className="flex items-center justify-between gap-2">
        <h2 className="section-label">Run outcome</h2>
        <span className="text-[11px] text-[color:var(--color-faint)]">recorded metrics</span>
      </header>
      <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-2.5">
        {rows.map((row) => (
          <div key={row.label} className="min-w-0" title={row.hint}>
            <dt className="text-[11px] text-[color:var(--color-muted)]">{row.label}</dt>
            <dd className="metric mt-0.5 text-[14px] font-semibold">
              {row.value ?? <span className="text-[12px] font-medium text-[color:var(--color-faint)]">unavailable</span>}
            </dd>
          </div>
        ))}
      </dl>
      <details className="mt-3">
        <summary className="cursor-pointer text-[11.5px] font-medium text-[color:var(--color-blue)]">Full metrics file</summary>
        <pre className="scroll-y mt-2 max-h-[40vh] rounded-[10px] bg-[color:var(--color-surface-muted)] p-2.5 font-[family-name:var(--font-mono)] text-[11px] leading-snug">
          {JSON.stringify(metrics, null, 2)}
        </pre>
      </details>
    </section>
  );
}
