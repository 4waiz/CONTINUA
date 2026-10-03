'use client';

/**
 * The four access links as one compact strip - for views where the links are
 * context rather than the subject (Scenario Lab). Same rules as the Mission
 * view's links panel: alternatives to one gateway, the carrying one solid, a
 * warming one breathing, a missing measurement shown as missing.
 */

import { LINK_IDS, LINK_LABEL, type EngineEvent, type EngineLinkId } from '@continua/contracts/engine';
import { NETWORK_COLOR } from '@continua/scene';
import { NetworkIcon } from '../ui/icons';

function phaseOf(event: EngineEvent | null, link: EngineLinkId) {
  if (!event) return 'unavailable' as const;
  if (event.carrying === link) return 'carrying' as const;
  const observation = event.links[link];
  if (!observation || observation.phase === 'unavailable') return 'unavailable' as const;
  if (observation.phase === 'activating' || observation.phase === 'validating') return 'warming' as const;
  return 'ready' as const;
}

const PHASE_LABEL = { carrying: 'Carrying', warming: 'Warming', ready: 'Available', unavailable: 'Unavailable' } as const;

export function LinkPills({ event }: { event: EngineEvent | null }) {
  return (
    <ul className="flex shrink-0 items-center gap-1.5" aria-label="Access links">
      {LINK_IDS.map((link) => {
        const phase = phaseOf(event, link);
        const color = NETWORK_COLOR[link];
        const carrying = phase === 'carrying';
        const observation = event?.links[link];
        const value =
          link === 'wifi' && observation?.rssi_dbm != null
            ? `${observation.rssi_dbm.toFixed(0)} dBm`
            : observation?.rtt_ms != null
              ? `${observation.rtt_ms.toFixed(0)} ms`
              : null;
        return (
          <li
            key={link}
            className="flex items-center gap-2 rounded-full py-1 pr-3 pl-1"
            style={{
              background: carrying ? `color-mix(in srgb, ${color} 12%, white)` : 'var(--color-surface-muted)',
              boxShadow: carrying ? `inset 0 0 0 1px color-mix(in srgb, ${color} 45%, transparent)` : undefined,
              opacity: phase === 'unavailable' && event ? 0.55 : 1,
            }}
            title={`${LINK_LABEL[link].label}: ${PHASE_LABEL[phase]}`}
          >
            <span
              className={`grid h-7 w-7 place-items-center rounded-full ${phase === 'warming' ? 'breathe' : ''}`}
              style={{ background: carrying ? color : 'white', color: carrying ? 'white' : color }}
            >
              <NetworkIcon link={link} size={15} />
            </span>
            <span className="leading-tight">
              <span className="block text-[12px] font-semibold">{LINK_LABEL[link].label}</span>
              <span className="block text-[11px] font-medium" style={{ color: carrying ? color : 'var(--color-faint)' }}>
                {value ?? PHASE_LABEL[phase]}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
