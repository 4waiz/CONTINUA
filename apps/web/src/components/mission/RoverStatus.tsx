'use client';

/**
 * Can each operator still reach their rover? The one question the whole
 * demonstration is about, answered at the top of the screen in words - one
 * card, the two rovers either side of it, so the moment one half goes red and
 * the other stays green is the moment the difference is.
 *
 * Read from the receiver's report in the run's own events (`app.in_outage`,
 * `outage_s`, `safe_stop`) and the link carrying the session - nothing is
 * inferred. While a rover is cut off, how long it has been is counted from
 * its own timeline: the run of consecutive events in which the receiver
 * reported the outage.
 */

import type { EngineEvent, EngineLinkId } from '@continua/contracts/engine';
import { NETWORK_COLOR } from '@continua/scene';
import { LinkLostIcon, NetworkIcon } from '../ui/icons';
import { InfoTip } from '../ui/InfoTip';
import { connectionState, NETWORK, seconds } from './plain';

/**
 * How long the receiver has been reporting an outage at `event`, from the
 * run's timeline; null while the session is up or when there is no timeline.
 */
export function cutOffFor(timeline: readonly EngineEvent[] | undefined, event: EngineEvent | null | undefined): number | null {
  if (!timeline || !event?.app?.in_outage) return null;
  let index = timeline.length - 1;
  while (index >= 0 && timeline[index]!.t > event.t + 1e-6) index -= 1;
  let start = event.t;
  for (; index >= 0; index -= 1) {
    const earlier = timeline[index]!;
    if (!earlier.app?.in_outage) break;
    start = earlier.t;
  }
  return Math.max(0, event.t - start);
}

function Side({
  name,
  event,
  timeline,
  ours,
  totals,
}: {
  name: string;
  event: EngineEvent | null;
  timeline?: readonly EngineEvent[];
  ours: boolean;
  totals: boolean;
}) {
  const state = connectionState(event);
  const tone = state.up === null ? 'var(--color-faint)' : state.up ? 'var(--color-good)' : 'var(--color-bad)';
  const carrying = (event?.carrying ?? null) as EngineLinkId | null;
  const lostFor = event?.app?.outage_s ?? 0;
  const down = cutOffFor(timeline, event);
  const detail =
    state.up === false
      ? `${down !== null ? `Cut off ${seconds(down)}` : 'Cut off'} · ${event?.app?.safe_stop ? 'rover stopped' : 'operator cannot reach it'}`
      : totals && state.up !== null
        ? `${state.detail}${lostFor >= 0.05 ? ` · ${seconds(lostFor)} offline in all` : ' · never cut off'}`
        : state.detail;
  return (
    <div
      className="versus-side rover-status"
      data-up={state.up === null ? undefined : String(state.up)}
      data-ours={ours}
      style={{ ['--tone' as string]: tone }}
      title="From the receiver: whether traffic is getting through to this rover now."
    >
      <span className={`rover-status-dot ${state.up ? 'breathe' : ''}`} aria-hidden />
      <div className="min-w-0">
        <div className="rover-status-name" style={{ color: ours ? 'var(--color-blue)' : 'var(--color-muted)' }}>
          {name}
        </div>
        <div className="rover-status-state">{state.label}</div>
        <div className="rover-status-detail metric">{detail}</div>
      </div>
      {carrying && state.up ? (
        <span
          className="rover-status-link"
          style={{ background: `color-mix(in srgb, ${NETWORK_COLOR[carrying]} 13%, white)`, color: NETWORK_COLOR[carrying] }}
          title={`${NETWORK[carrying].name} is carrying this rover's link`}
        >
          <NetworkIcon link={carrying} size={16} />
        </span>
      ) : state.up === false ? (
        <span className="rover-status-link rover-status-lost" title="No link is getting through">
          <LinkLostIcon size={16} />
        </span>
      ) : null}
    </div>
  );
}

export function RoverStatus({
  main,
  mainName,
  mainTimeline,
  baseline,
  baselineName = 'Normal rover',
  baselineTimeline,
  totals = false,
}: {
  main: EngineEvent | null;
  mainName: string;
  /** This run's events so far, to count how long an outage has lasted. */
  mainTimeline?: readonly EngineEvent[];
  /** The normal rover's event at the same moment; undefined when it is not running. */
  baseline?: EngineEvent | null;
  baselineName?: string;
  baselineTimeline?: readonly EngineEvent[];
  /**
   * Add each rover's running total offline. Details only: it counts the
   * session's first fifth of a second, before the cable path is up - the same
   * for every rover - and on its own that read as a fault at the dock.
   */
  totals?: boolean;
}) {
  const pair = baseline !== undefined;
  return (
    <div className="pointer-events-none flex items-center gap-2" aria-label="Can each operator reach their rover?">
      <div className="versus" data-pair={pair} data-tour="mission-status">
        <Side name={mainName} event={main} timeline={mainTimeline} ours totals={totals} />
        {pair && (
          <>
            <span className="versus-vs" aria-hidden>
              vs
            </span>
            <Side name={baselineName} event={baseline} timeline={baselineTimeline} ours={false} totals={totals} />
          </>
        )}
      </div>
      <span className="pointer-events-auto self-center">
        <InfoTip
          align="end"
          text={
            totals
              ? "Can each operator reach their rover right now? From the receiver's own report. 'Offline in all' adds up every moment the rover was out of reach this run, the session's start included."
              : "Can each operator reach their rover right now? From the receiver's own report, and which network is carrying the link. Both rovers drive the same road through the same signal: only the strategy differs."
          }
        />
      </span>
    </div>
  );
}
