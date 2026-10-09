'use client';
/* Copyright (c) 2026 Kanban Studios F.Z.E. All rights reserved. Proprietary - see LICENSE. KS-CONTINUA-8B5F43307114 */

/**
 * The moment banner under the status card: the one thing that just happened,
 * said once, for a few seconds - the road map's warning of a dead zone, or a
 * change of network and why. It is the only place the drive says what the
 * controller did; the dock no longer repeats it in a line of its own, and the
 * voice says the same short words.
 *
 * Every word is read from the run's own decisions (`plain.ts`); the "already
 * up" note is the target link's recorded phase just before the switch.
 */

import type { EngineLinkId } from '@continua/contracts/engine';
import { NETWORK_COLOR } from '@continua/scene';
import { NetworkIcon, RoadMapIcon } from '../ui/icons';
import { NETWORK } from './plain';

export type MomentSpec =
  | { kind: 'warning'; key: string; at: number; title: string; detail: string; link: EngineLinkId }
  | { kind: 'handoff'; key: string; at: number; from: EngineLinkId | null; to: EngineLinkId; detail: string | null };

export function Moment({ moment, holdSeconds }: { moment: MomentSpec; holdSeconds: number }) {
  const color = NETWORK_COLOR[moment.kind === 'warning' ? moment.link : moment.to];
  return (
    <div className="moment glass drop-in" key={moment.key} data-kind={moment.kind} style={{ ['--moment' as string]: color }} role="status">
      <span aria-hidden className="countdown moment-countdown" style={{ animationDuration: `${holdSeconds}s` }} />
      {moment.kind === 'warning' ? (
        <span className="moment-icon" aria-hidden>
          <RoadMapIcon size={17} />
        </span>
      ) : (
        <span className="flex shrink-0 items-center gap-1.5" aria-hidden>
          {moment.from && (
            <span
              className="grid h-7 w-7 place-items-center rounded-full"
              style={{ background: `color-mix(in srgb, ${NETWORK_COLOR[moment.from]} 14%, white)`, color: NETWORK_COLOR[moment.from] }}
            >
              <NetworkIcon link={moment.from} size={15} />
            </span>
          )}
          <span className="text-[13px] text-[color:var(--color-faint)]">→</span>
          <span className="grid h-7 w-7 place-items-center rounded-full text-white" style={{ background: color }}>
            <NetworkIcon link={moment.to} size={15} />
          </span>
        </span>
      )}
      <div className="min-w-0">
        <div className="moment-title">
          {moment.kind === 'warning' ? moment.title : `Moved to ${NETWORK[moment.to].name}`}
          <span className="moment-time metric">t+{moment.at.toFixed(1)}s</span>
        </div>
        {moment.detail && <div className="moment-detail">{moment.detail}</div>}
      </div>
    </div>
  );
}
