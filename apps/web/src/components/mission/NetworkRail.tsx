'use client';

/**
 * The four access networks, as candidate paths to one gateway.
 *
 * The single most important thing this component must not imply is that packets
 * travel wired → Wi-Fi → cellular → satellite in sequence. They are
 * alternatives. So the connector between the nodes is drawn to a **shared
 * gateway rail** rather than node-to-node, and only the carrying link gets a
 * solid line; a warming backup gets a dashed animated one, and everything else
 * gets nothing.
 *
 * Every value shown is a receiver-side measurement from the current event, or
 * `unavailable`. Wi-Fi is the only link with an RSSI, and it is the only one
 * that ever shows one.
 */

import { LINK_IDS, LINK_LABEL, type EngineEvent, type EngineLinkId } from '@continua/contracts/engine';
import { NETWORK_COLOR } from '@continua/scene';

type Phase = 'carrying' | 'warming' | 'ready' | 'unavailable';

function phaseOf(event: EngineEvent | null, link: EngineLinkId): Phase {
  if (!event) return 'unavailable';
  if (event.carrying === link) return 'carrying';
  const observation = event.links[link];
  if (!observation) return 'unavailable';
  if (observation.phase === 'unavailable') return 'unavailable';
  if (observation.phase === 'activating' || observation.phase === 'validating') return 'warming';
  return 'ready';
}

const PHASE_LABEL: Record<Phase, string> = {
  carrying: 'CARRYING',
  warming: 'PRE-WARMING',
  ready: 'AVAILABLE',
  unavailable: 'UNAVAILABLE',
};

/** The headline figure per link: what an operator would look at first. */
function headline(event: EngineEvent | null, link: EngineLinkId): { value: string; caption: string } {
  const observation = event?.links[link];
  if (!observation) return { value: ' - ', caption: 'no measurement' };

  if (link === 'wifi' && observation.rssi_dbm !== null) {
    return { value: `${observation.rssi_dbm.toFixed(0)} dBm`, caption: '' };
  }
  if (observation.rtt_ms !== null) {
    return { value: `${observation.rtt_ms.toFixed(0)} ms`, caption: '' };
  }
  // Say why a link shows no signal figure rather than leaving a blank - but
  // only where someone might expect one. Nobody looks for an RSSI on Ethernet,
  // so that note on the wired card was just noise.
  if (link === 'cellular' || link === 'satellite') {
    return { value: 'unavailable', caption: 'RSSI is a Wi-Fi measurement' };
  }
  return { value: 'unavailable', caption: '' };
}

export function NetworkRail({
  event,
  selected,
  onSelect,
}: {
  event: EngineEvent | null;
  selected: EngineLinkId | null;
  onSelect?: (link: EngineLinkId) => void;
}) {
  return (
    <div className="relative">
      {/* The shared gateway rail. Nodes hang off it; they do not chain. */}
      <svg
        aria-hidden
        className="pointer-events-none absolute inset-x-6 top-0 h-[18px] w-[calc(100%-3rem)]"
        preserveAspectRatio="none"
        viewBox="0 0 100 18"
      >
        <defs>
          <linearGradient id="continua-rail" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#14b8e8" />
            <stop offset="50%" stopColor="#176bff" />
            <stop offset="100%" stopColor="#7a3cff" />
          </linearGradient>
        </defs>
        <line x1="0" y1="9" x2="100" y2="9" stroke="url(#continua-rail)" strokeWidth="1.5" strokeOpacity="0.28" />
        <line
          x1="0"
          y1="9"
          x2="100"
          y2="9"
          stroke="url(#continua-rail)"
          strokeWidth="1.5"
          strokeDasharray="6 6"
          className="flow-line"
        />
      </svg>

      <span
        className="absolute -top-[3px] left-1/2 z-10 -translate-x-1/2 cursor-help rounded-full border border-[color:var(--color-line)] bg-white px-2.5 py-[1px] text-[11px] font-semibold uppercase tracking-[0.07em] text-[color:var(--color-faint)]"
        title="Four alternative paths to one gateway - not a chain traffic passes through in sequence. The solid rail is the session; a breathing dot is a backup being warmed."
      >
        Gateway
      </span>

      <div className="grid grid-cols-4 gap-3 pt-[18px]">
        {LINK_IDS.map((link) => {
          const phase = phaseOf(event, link);
          const { value, caption } = headline(event, link);
          const color = NETWORK_COLOR[link];
          const carrying = phase === 'carrying';
          const dim = phase === 'unavailable';
          const isSelected = selected === link;

          return (
            <button
              key={link}
              type="button"
              onClick={() => onSelect?.(link)}
              aria-pressed={isSelected}
              className={`card group relative flex flex-col gap-1.5 px-4 py-3 text-left transition ${
                carrying ? 'card-active' : ''
              } ${isSelected && !carrying ? 'border-[color:var(--color-line-strong)]' : ''}`}
              style={{
                opacity: dim ? 0.5 : 1,
                borderTopColor: carrying ? color : undefined,
                borderTopWidth: carrying ? 2 : undefined,
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[14px] font-semibold" style={{ color: dim ? 'var(--color-faint)' : color }}>
                  {LINK_LABEL[link].label}
                </span>
                <span
                  className={`h-[9px] w-[9px] rounded-full ${phase === 'warming' ? 'breathe' : ''}`}
                  style={{
                    background: carrying ? color : phase === 'warming' ? color : 'var(--color-line-strong)',
                    boxShadow: carrying ? `0 0 0 4px color-mix(in srgb, ${color} 18%, transparent)` : undefined,
                  }}
                />
              </div>

              <div className="metric text-[19px] font-semibold leading-none tracking-[-0.03em]">
                {value === 'unavailable' ? (
                  <span className="text-[14px] font-medium text-[color:var(--color-faint)]">unavailable</span>
                ) : (
                  value
                )}
              </div>

              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[11px] text-[color:var(--color-muted)]">{caption}</span>
                <span
                  className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.07em]"
                  style={{ color: carrying ? color : 'var(--color-faint)' }}
                >
                  {PHASE_LABEL[phase]}
                </span>
              </div>
            </button>
          );
        })}
      </div>


    </div>
  );
}
