'use client';
/* Copyright (c) 2026 Kanban Studios F.Z.E. All rights reserved. Proprietary - see LICENSE. KS-CONTINUA-73C58863CE44 */

/**
 * Head to head: what each operator has lived through so far, side by side.
 *
 * The two rovers drive the same road through the same signal at the same
 * moment, so every gap between these numbers is the strategy's doing. Each is
 * a running total the engine carries in the event itself - the receiver's
 * counters for time without a link, frozen video and steering commands past
 * their deadline, and the bytes the satellite path has carried - read from the
 * two runs' events at the same moment of the road. Nothing is summed or
 * smoothed here, and a value an event does not carry reads "unavailable",
 * never 0.
 *
 * The bars make the size of a gap visible at a glance. The ratio beside a row
 * appears only once both totals are big enough for it to mean something: 0.2 s
 * against 1.0 s is the session's start-up, not a result.
 */

import type { EngineEvent } from '@continua/contracts/engine';
import type { ReactNode } from 'react';
import { InfoTip } from '../ui/InfoTip';

interface Measure {
  id: string;
  label: string;
  tip: string;
  read: (event: EngineEvent) => number | null;
  format: (value: number) => string;
  /** Both totals must reach this before a ratio is shown. */
  floor: number;
  /**
   * The bars' full length is at least this much, so a fifth of a second
   * against nothing reads as two small bars, not a full one and an empty one.
   */
  scale: number;
}

const secondsShort = (value: number): string => (value < 10 ? `${value.toFixed(1)} s` : `${value.toFixed(0)} s`);

/** Bytes as a person reads them: "3 KB", "5.6 MB", "107 MB". */
export function dataSize(megabytes: number): string {
  if (megabytes < 1) return `${(megabytes * 1000).toFixed(0)} KB`;
  return megabytes < 100 ? `${megabytes.toFixed(1)} MB` : `${megabytes.toFixed(0)} MB`;
}

export const MEASURES: readonly Measure[] = [
  {
    id: 'offline',
    label: 'Time without a link',
    tip: "Seconds the operator could not reach the rover at all, from the receiver's report. Both rovers start with the same fifth of a second while the session comes up.",
    read: (event) => (event.app ? event.app.outage_s : null),
    format: secondsShort,
    floor: 1,
    scale: 5,
  },
  {
    id: 'video',
    label: 'Video frozen',
    tip: "Seconds the operator's camera picture was stalled: no new frame arrived in time.",
    read: (event) => {
      const stall = event.app?.classes.video?.stall_ms;
      return stall === null || stall === undefined ? null : stall / 1000;
    },
    format: secondsShort,
    floor: 2,
    scale: 5,
  },
  {
    id: 'late',
    label: 'Steering commands late',
    tip: 'Share of steering commands that arrived after their deadline (150 ms when driven live), or could not be sent at all. A command dropped on the way is not counted here.',
    read: (event) => event.app?.classes.control?.deadline_miss_pct ?? null,
    format: (value) => `${value < 10 ? value.toFixed(1) : value.toFixed(0)} %`,
    floor: 5,
    scale: 10,
  },
  {
    id: 'satellite',
    label: 'Data over satellite',
    tip: 'Everything sent over the satellite link so far - the slow, costly one - counted on the link itself.',
    read: (event) => {
      const bytes = event.links.satellite?.link_bytes;
      return bytes === undefined ? null : bytes / 1e6;
    },
    format: dataSize,
    floor: 0.5,
    scale: 2,
  },
];

function times(value: number): string {
  return value < 10 ? `${value.toFixed(1)}×` : `${value.toFixed(0)}×`;
}

/** "3.1× less" when ours is lower, "1.8× more" when it is higher - whichever is true. */
function ratioOf(main: number | null, base: number | null | undefined, floor: number): { text: string; better: 'main' | 'base' } | null {
  if (main === null || base === null || base === undefined) return null;
  if (Math.min(main, base) < floor) return null;
  const high = Math.max(main, base);
  const low = Math.min(main, base);
  if (high / low < 1.5) return null;
  return main < base ? { text: `${times(high / low)} less`, better: 'main' } : { text: `${times(high / low)} more`, better: 'base' };
}

function Line({ side, value, max, format }: { side: 'main' | 'base'; value: number | null; max: number; format: (value: number) => string }) {
  const width = value === null || max <= 0 ? 0 : Math.max(1.5, (value / max) * 100);
  return (
    <div className="h2h-line" data-side={side}>
      <span className="h2h-track" aria-hidden>
        <span className="h2h-fill" style={{ width: `${width}%` }} />
      </span>
      <span className="h2h-value metric">{value === null ? <span className="h2h-missing">unavailable</span> : format(value)}</span>
    </div>
  );
}

export function HeadToHead({
  main,
  baseline,
  mainName,
  baselineName = 'Normal rover',
  camera,
}: {
  main: EngineEvent | null;
  /** The normal rover's event at the same moment; undefined when it is not running. */
  baseline?: EngineEvent | null;
  mainName: string;
  baselineName?: string;
  /** The operators' camera views, shown above the totals. */
  camera?: ReactNode;
}) {
  const compare = baseline !== undefined;
  return (
    <section className="glass h2h" aria-label="Head to head" data-tour="mission-scoreboard">
      <header className="h2h-head">
        <h2 className="section-label flex items-center gap-1.5">
          {compare ? 'Head to head' : 'So far'}
          <InfoTip
            align="end"
            text={
              compare
                ? "Running totals from each rover's own receiver, read at the same moment of the same road. The shorter bar is the better one."
                : "Running totals from this rover's own receiver."
            }
          />
        </h2>
        {compare && (
          <span className="h2h-legend" aria-hidden>
            <span data-side="main">{mainName}</span>
            <span data-side="base">{baselineName.replace(/ rover$/i, '')}</span>
          </span>
        )}
      </header>
      {camera && <div className="h2h-camera">{camera}</div>}
      <ul className="h2h-rows">
        {MEASURES.map((measure) => {
          const mainValue = main ? measure.read(main) : null;
          const baseValue = baseline ? measure.read(baseline) : baseline === null ? null : undefined;
          const ratio = ratioOf(mainValue, baseValue, measure.floor);
          const max = Math.max(mainValue ?? 0, baseValue ?? 0, measure.scale);
          return (
            <li key={measure.id} className="h2h-row" title={measure.tip}>
              <div className="h2h-row-head">
                <span className="h2h-label">{measure.label}</span>
                {ratio && (
                  <span className="h2h-ratio" data-better={ratio.better}>
                    {mainName}: {ratio.text}
                  </span>
                )}
              </div>
              <Line side="main" value={mainValue} max={max} format={measure.format} />
              {compare && <Line side="base" value={baseValue ?? null} max={max} format={measure.format} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
