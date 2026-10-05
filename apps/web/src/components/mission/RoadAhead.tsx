'use client';

/**
 * The road ahead: the whole route as one strip, with where each network can
 * be expected along it, where the rover is, and - for CONTINUA with the road
 * map - the stretch it is looking up right now.
 *
 * The availability rows are the radio map itself (`GET /api/radio-maps/{id}`):
 * the share of earlier survey drives on which each link was unusable, per 5 m
 * of route, drawn as available where that share is under one half - the same
 * threshold the controller uses. They are what the route-aware policy *expects*,
 * labelled as such, and never a measurement of the run on screen; the run's own
 * story is the timeline beneath. A scenario's cuttings are marked where its
 * walls stand, so the strip and the 3D world point at the same place - and on
 * `shadow-stale` they visibly disagree, which is the point of that scenario.
 *
 * The look-ahead bracket is the policy's actual horizon: 8 s at the rover's
 * current speed (`route_horizon_s` in the engine's policy config).
 */

import type { RadioMap } from '@/lib/api';
import { api } from '@/lib/api';
import type { EngineLinkId } from '@continua/contracts/engine';
import { MISSION_ZONES, NETWORK_COLOR, route, type DeadZone } from '@continua/scene';
import { useEffect, useMemo, useState } from 'react';
import { InfoTip } from '../ui/InfoTip';
import { NETWORK } from './plain';

/** The route-aware policy's look-ahead, seconds (controller `route_horizon_s`). */
export const LOOKAHEAD_S = 8;
/** A bin counts as unavailable at this share of survey samples (`route_unusable_at`). */
const UNUSABLE_AT = 0.5;

const ROWS: readonly EngineLinkId[] = ['wifi', 'cellular', 'satellite'];

const cache = new Map<string, Promise<RadioMap>>();

/** A radio map by survey id, fetched once per page. */
export function useRadioMap(id: string | null): RadioMap | null {
  const [state, setState] = useState<{ id: string; map: RadioMap } | null>(null);
  useEffect(() => {
    if (!id) return undefined;
    let cancelled = false;
    let request = cache.get(id);
    if (!request) {
      request = api.radioMap(id);
      cache.set(id, request);
      request.catch(() => cache.delete(id));
    }
    request.then(
      (map) => {
        if (!cancelled) setState({ id, map });
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [id]);
  return state && state.id === id ? state.map : null;
}

/** Stretches of route (metres) on which the map expects `link` to be usable. */
function availableSpans(map: RadioMap, link: EngineLinkId): [number, number][] {
  const shares = map.links[link]?.unusable_share ?? [];
  const spans: [number, number][] = [];
  let open: number | null = null;
  shares.forEach((share, index) => {
    const usable = share < UNUSABLE_AT;
    if (usable && open === null) open = index * map.bin_m;
    if (!usable && open !== null) {
      spans.push([open, index * map.bin_m]);
      open = null;
    }
  });
  if (open !== null) spans.push([open, Math.min(shares.length * map.bin_m, map.length_m)]);
  return spans;
}

export function RoadAhead({
  map,
  position,
  direction = 1,
  speedMps = 0,
  lookahead = false,
  preparing = false,
  deadZones = [],
  compact = false,
}: {
  map: RadioMap | null;
  /** The rover's place on the route, metres from the forward start; null before a run. */
  position: number | null;
  direction?: 1 | -1;
  speedMps?: number;
  /** Draw the policy's look-ahead bracket (route-aware policies only). */
  lookahead?: boolean;
  /** The policy is preparing a path for a gap it has seen ahead. */
  preparing?: boolean;
  /** Where the scenario's cuttings stand. */
  deadZones?: readonly DeadZone[];
  compact?: boolean;
}) {
  const length = map?.length_m ?? route.length;
  const x = (metres: number) => `${(Math.max(0, Math.min(length, metres)) / length) * 100}%`;
  const spans = useMemo(
    () => (map ? Object.fromEntries(ROWS.map((link) => [link, availableSpans(map, link)])) : null),
    [map],
  ) as Record<EngineLinkId, [number, number][]> | null;

  const reach = lookahead && position !== null ? Math.max(12, speedMps * LOOKAHEAD_S) : 0;
  const bracket =
    position === null || reach === 0
      ? null
      : direction > 0
        ? [position, Math.min(length, position + reach)]
        : [Math.max(0, position - reach), position];
  const rowHeight = compact ? 6 : 7;
  const rowGap = compact ? 7 : 8;
  const top = compact ? 16 : 18;
  // A cutting's label gives way to the horizon's when the two would meet.
  const labelClear = (zone: DeadZone) =>
    !bracket || bracket[1]! < zone.from - zone.ramp / 2 - 40 || bracket[0]! > zone.to + zone.ramp / 2 + 40;

  return (
    <div className="flex min-w-0 items-stretch gap-2.5" aria-label="The road ahead">
      <div className="relative shrink-0" style={{ width: 60 }}>
        <span className="absolute left-0" style={{ top: top + ROWS.length * (rowHeight + rowGap) - 1 }}>
          <InfoTip
            side="right"
            text="The road ahead: where each network is expected along the route, from a road map built on earlier drives. Hatched: a cutting. The bracket is what CONTINUA with the road map looks up - the next 8 seconds."
          />
        </span>
        {ROWS.map((link, row) => (
          <span
            key={link}
            className="absolute left-0 text-[10.5px] font-bold leading-none"
            style={{ top: top + row * (rowHeight + rowGap) + rowHeight / 2 - 5.5, color: NETWORK_COLOR[link] }}
          >
            {NETWORK[link].name}
          </span>
        ))}
      </div>
      <div className="relative min-w-0 flex-1" style={{ height: top + ROWS.length * (rowHeight + rowGap) + (compact ? 13 : 15) }}>
        {/* Where the scenario's cuttings stand: hatched, behind the rows. */}
        {deadZones.map((zone) => (
          <div
            key={`${zone.from}-${zone.to}`}
            className="dead-zone-hatch absolute rounded-[4px]"
            style={{
              left: x(zone.from - zone.ramp / 2),
              width: `calc(${x(zone.to + zone.ramp / 2)} - ${x(zone.from - zone.ramp / 2)})`,
              top: top - 3,
              height: ROWS.length * (rowHeight + rowGap) + 2,
            }}
            title={`Cutting: ${zone.links.map((link) => NETWORK[link as EngineLinkId]?.name ?? link).join(' and ')} blocked here`}
          >
            {labelClear(zone) && (
              <span className="absolute -top-[14px] left-1/2 -translate-x-1/2 whitespace-nowrap text-[10.5px] font-bold uppercase tracking-[0.06em] text-[color:var(--color-ink)]">
                Cutting
              </span>
            )}
          </div>
        ))}

        {/* What the road map expects, one row per network. */}
        {ROWS.map((link, row) => (
          <div
            key={link}
            className="absolute inset-x-0 rounded-full bg-[color:var(--color-line)]"
            style={{ top: top + row * (rowHeight + rowGap), height: rowHeight }}
          >
            {spans?.[link]?.map(([from, to]) => (
              <span
                key={from}
                className="absolute inset-y-0 rounded-full"
                style={{ left: x(from), width: `calc(${x(to)} - ${x(from)})`, background: NETWORK_COLOR[link], opacity: 0.85 }}
              />
            ))}
          </div>
        ))}

        {/* Zones along the bottom, for bearings - the compact strip leaves
            them to the route card, which names the one the rover is in. */}
        <div className="absolute inset-x-0 bottom-0 h-[12px]" aria-hidden hidden={compact}>
          {MISSION_ZONES.map((zone) => (
            <span
              key={zone.id}
              className="absolute truncate text-[10.5px] font-medium leading-[12px] text-[color:var(--color-faint)]"
              style={{ left: x(zone.fromDistance), width: `calc(${x(zone.toDistance)} - ${x(zone.fromDistance)})` }}
            >
              {zone.label}
            </span>
          ))}
        </div>

        {/* The policy's horizon: what it is looking up right now. */}
        {bracket && (
          <div
            className="absolute rounded-[5px] transition-[background,border-color] duration-300"
            style={{
              left: x(bracket[0]!),
              width: `calc(${x(bracket[1]!)} - ${x(bracket[0]!)})`,
              top: top - 6,
              height: ROWS.length * (rowHeight + rowGap) + 8,
              border: `1.5px solid ${preparing ? 'var(--color-violet)' : 'color-mix(in srgb, var(--color-blue) 55%, transparent)'}`,
              background: preparing
                ? 'color-mix(in srgb, var(--color-violet) 16%, transparent)'
                : 'color-mix(in srgb, var(--color-blue) 8%, transparent)',
            }}
            title={`What CONTINUA looks up in its road map: the next ${LOOKAHEAD_S} s of road at the rover's speed`}
          >
            <span
              className="absolute -top-[15px] whitespace-nowrap text-[10.5px] font-bold"
              style={{
                color: preparing ? 'var(--color-violet)' : 'var(--color-blue)',
                ...(direction > 0 ? { left: 0 } : { right: 0 }),
              }}
            >
              {preparing ? 'Gap ahead: getting satellite ready' : `Next ${LOOKAHEAD_S} s`}
            </span>
          </div>
        )}

        {/* The rover. */}
        {position !== null && (
          <div className="absolute" style={{ left: x(position), top: top - 7, height: ROWS.length * (rowHeight + rowGap) + 10 }}>
            <span className="absolute inset-y-0 left-0 w-[2px] -translate-x-1/2 rounded-full bg-[color:var(--color-ink)]" />
            <span className="absolute -top-[3px] left-0 h-[9px] w-[9px] -translate-x-1/2 rounded-full border-2 border-white bg-[color:var(--color-ink)] shadow-[0_1px_3px_rgb(20_33_61/0.35)]" />
          </div>
        )}

        {!map && (
          <span className="absolute inset-x-0 text-center text-[11px] text-[color:var(--color-faint)]" style={{ top: top + 2 }}>
            road map unavailable
          </span>
        )}
      </div>
    </div>
  );
}
