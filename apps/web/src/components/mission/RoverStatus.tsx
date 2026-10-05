'use client';

/**
 * Can each operator still reach their rover? The one question the whole
 * demonstration is about, answered at the top of the screen in words.
 *
 * Read from the receiver's report in the run's own events (`app.in_outage`,
 * `outage_s`, `safe_stop`) and the link carrying the session - nothing is
 * inferred. Beside the normal rover the two read as a pair, so the moment
 * one goes red and the other stays green is the moment the difference is.
 */

import type { EngineEvent, EngineLinkId } from '@continua/contracts/engine';
import { NETWORK_COLOR } from '@continua/scene';
import { NetworkIcon } from '../ui/icons';
import { InfoTip } from '../ui/InfoTip';
import { connectionState, NETWORK, seconds } from './plain';

function Card({ name, event, ours }: { name: string; event: EngineEvent | null; ours: boolean }) {
  const state = connectionState(event);
  const tone = state.up === null ? 'var(--color-faint)' : state.up ? 'var(--color-good)' : 'var(--color-bad)';
  const carrying = (event?.carrying ?? null) as EngineLinkId | null;
  const lostFor = event?.app?.outage_s ?? 0;
  return (
    <div
      className="rover-status"
      data-up={state.up === null ? undefined : String(state.up)}
      style={{ ['--tone' as string]: tone }}
      title="From the receiver: whether traffic is getting through to this rover now."
    >
      <span className={`rover-status-dot ${state.up ? 'breathe' : ''}`} aria-hidden />
      <div className="min-w-0">
        <div className="rover-status-name" style={{ color: ours ? 'var(--color-blue)' : 'var(--color-muted)' }}>
          {name}
        </div>
        <div className="rover-status-state">{state.label}</div>
        <div className="rover-status-detail">
          {state.up === false
            ? `${state.detail}${lostFor > 0 ? ` · ${seconds(lostFor)} offline in all` : ''}`
            : state.up
              ? `${state.detail}${lostFor >= 0.05 ? ` · ${seconds(lostFor)} offline in all` : ' · never cut off'}`
              : state.detail}
        </div>
      </div>
      {carrying && state.up && (
        <span
          className="rover-status-link"
          style={{ background: `color-mix(in srgb, ${NETWORK_COLOR[carrying]} 13%, white)`, color: NETWORK_COLOR[carrying] }}
          title={`${NETWORK[carrying].name} is carrying this rover's link`}
        >
          <NetworkIcon link={carrying} size={16} />
        </span>
      )}
    </div>
  );
}

export function RoverStatus({
  main,
  mainName,
  baseline,
  baselineName = 'Normal rover',
}: {
  main: EngineEvent | null;
  mainName: string;
  /** The normal rover's event at the same moment; undefined when it is not running. */
  baseline?: EngineEvent | null;
  baselineName?: string;
}) {
  return (
    <div className="pointer-events-none flex items-stretch gap-2.5" aria-label="Can each operator reach their rover?">
      <Card name={mainName} event={main} ours />
      {baseline !== undefined && <Card name={baselineName} event={baseline} ours={false} />}
      <span className="pointer-events-auto self-center">
        <InfoTip
          text="Can each operator reach their rover right now? From the receiver's own report. 'Offline in all' adds up every moment the rover was out of reach this run."
        />
      </span>
    </div>
  );
}
